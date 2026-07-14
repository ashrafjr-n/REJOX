"""Migration orchestrator — the back half of the pipeline, instrumented.

``run_migration`` drives emit → npm install → tsc → Metro export → (repair) →
done, emitting a real event at each true boundary via the ``emit`` sink. Every
event carries only observed facts (files written, diagnostics found, LLM calls
made, repair round N of M); nothing is estimated and no stage is reported
complete until it actually completed.

The one genuine reasoning call — the navigator SHAPE — happens at the start of
emit (the product's single LLM call); its count lands in the emit event and the
terminal result. Everything else is deterministic (rules) or a real tool.

This is the shared engine the async job layer runs in the background. The CLI
keeps its own synchronous path (it renders live); both call the same underlying
pipeline functions, so behavior cannot drift.
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any, Callable, Optional

from app.models.analysis import AnalysisReport
from app.models.jobs import MigrationError, MigrationEventData, MigrationResult
from app.models.knowledge_graph import KnowledgeGraph
from app.models.plan import MigrationPlan
from app.pipeline.emit import emit_project
from app.pipeline.repair import repair_project
from app.pipeline.validator import (
    map_diagnostics,
    validate_project,
    validated_scores,
)

# emit(type, stage, message, *, data=None, result=None, error=None) — the sink
# the job layer supplies; it stamps seq + ts and appends to the job.
EventSink = Callable[..., None]

_STAGE_MSG = {
    "install": "npm install",
    "typecheck": "Type-check (tsc)",
    "bundle": "Bundle (Metro export)",
}


# --- provider seam (mirrors the CLI's selection; offline 'fake' for demos/CI) --


class _CountingProvider:
    """Wraps the real provider to tally the REAL number of LLM calls made."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.calls = 0
        self.model = getattr(inner, "model", getattr(inner, "model_name", "?"))

    def complete(self, system: str, user: str, *, max_tokens: int):
        resp = self._inner.complete(system, user, max_tokens=max_tokens)
        self.calls += 1
        return resp


def select_migration_provider() -> tuple[Optional[Any], str]:
    """Pick the LLM provider for the one reasoning step (navigator shape):
    ``GEMINI_API_KEY`` → real Gemini; ``REJOX_AI_PROVIDER=fake`` → the offline
    deterministic provider (a real single call, no network); else → disabled.
    """
    if os.environ.get("GEMINI_API_KEY"):
        try:
            from app.ai.config import get_provider

            provider = get_provider()
            return provider, getattr(provider, "model", "gemini")
        except Exception:
            return None, "none"
    if os.environ.get("REJOX_AI_PROVIDER", "").strip().lower() == "fake":
        from app.ai.provider import FakeProvider

        return FakeProvider(), "fake (offline)"
    return None, "none"


# --- navigator-shape decision (the single genuine LLM call) ------------------


def _nav_ui_summary(report: AnalysisReport, kg: KnowledgeGraph):
    from app.ai.navigation import NavLinkSummary, NavUiSummary

    routes = report.routing.routes
    links = [
        NavLinkSummary(label=r.screenName, to=r.path or "/")
        for r in routes
        if r.componentName and ":" not in (r.path or "")
    ]
    nav_name = next(
        (c.name for c in kg.components if re.search(r"nav|header|menu", c.name, re.I)),
        "Navbar",
    )
    return NavUiSummary(component=nav_name, links=links, persistent=bool(routes), hasSidebar=False)


def _seed_offline_shape(provider: Any, routes: list, nav_ui: Any) -> None:
    """Seed the offline FakeProvider with a valid navigator spec so the shape
    prompt resolves in exactly one successful call (no-op for real providers)."""
    from app.ai.provider import FakeProvider

    if not isinstance(provider, FakeProvider):
        return
    import json as _json

    from app.ai.navigation import shape_prompt

    top = [r.screenName for r in routes if r.componentName and ":" not in (r.path or "")]
    nested = []
    for r in routes:
        if r.params and r.path and "/" in r.path:
            parent_path = r.path.rsplit("/", 1)[0]
            parent = next(
                (x.screenName for x in routes if (x.path or "").strip("/") == parent_path),
                None,
            )
            if parent:
                nested.append({"type": "stack", "parent": parent, "screens": [parent, r.screenName]})
    spec = {
        "type": "tabs", "screens": top, "nested": nested,
        "rationale": f"A persistent {len(top)}-link top nav maps to bottom tabs; "
                     "detail routes nest in a stack.",
    }
    system, user = shape_prompt(routes, nav_ui)
    provider.register(system, user, _json.dumps(spec))


def _decide_navigator_shape(
    report: AnalysisReport, kg: KnowledgeGraph, counter: Optional[_CountingProvider]
) -> Optional[str]:
    """The one genuine reasoning step. With a provider: the LLM proposes a shape
    (1 real call, counted by ``counter``). Without one: the deterministic stack
    default. Returns the chosen shape, or None when the app has no routes."""
    from app.ai.navigation import infer_navigator_shape

    routes = report.routing.routes
    if not routes:
        return None
    if counter is None:
        return "stack"
    nav_ui = _nav_ui_summary(report, kg)
    _seed_offline_shape(counter._inner, routes, nav_ui)
    try:
        proposal = infer_navigator_shape(routes, nav_ui, provider=counter)
    except Exception:
        return "stack"
    return "stack" if proposal.fellBack else proposal.resolution.spec.type.value


# --- orchestration -----------------------------------------------------------


def _progress_data(stage: str, payload: dict[str, Any], llm_calls: int) -> MigrationEventData:
    if stage == "install":
        return MigrationEventData(
            installed=payload.get("installed"),
            installSkipped=payload.get("installSkipped"),
            llmCalls=llm_calls,
        )
    return MigrationEventData(
        ran=payload.get("ran"),
        passed=payload.get("passed"),
        errorCount=payload.get("errorCount"),
        diagnosticsFound=payload.get("diagnosticsFound"),
        skippedReason=payload.get("skippedReason"),
        llmCalls=llm_calls,
    )


def run_migration(
    *,
    kg: KnowledgeGraph,
    report: AnalysisReport,
    plan: MigrationPlan,
    source_root: Path,
    answers: dict[str, str],
    out_dir: Path,
    run_id: Optional[str],
    install: bool,
    run_bundle: bool,
    emit: EventSink,
) -> MigrationResult:
    """Run the instrumented migration, emitting a real event at each boundary."""
    started = time.monotonic()
    raw_provider, _label = select_migration_provider()
    counter = _CountingProvider(raw_provider) if raw_provider is not None else None
    calls = lambda: (counter.calls if counter is not None else 0)

    current_stage = "emit"
    try:
        # --- STAGE: emit (incl. the single navigator-shape LLM decision) ---
        emit("stage_started", "emit", "Emitting the React Native project")
        answers = dict(answers)
        shape = _decide_navigator_shape(report, kg, counter)
        if shape and not answers.get("navigator-shape"):
            answers["navigator-shape"] = shape
        navigator_shape = answers.get("navigator-shape") or shape

        emission = emit_project(
            plan, answers, kg, out_dir, report=report, source_root=source_root
        )
        files_converted = sum(1 for f in emission.files if f.sourceFile)
        emit(
            "stage_completed", "emit", "Emitted the React Native project",
            data=MigrationEventData(
                filesEmitted=len(emission.files),
                filesConverted=files_converted,
                filesSkipped=len(emission.skipped),
                todoCount=emission.todoCount,
                navigatorShape=navigator_shape,
                llmCalls=calls(),
            ),
        )

        # --- STAGES: install → typecheck → bundle (real tools) ---
        def on_progress(stage: str, phase: str, payload: dict[str, Any]) -> None:
            nonlocal current_stage
            current_stage = stage
            if phase == "started":
                emit("stage_started", stage, f"{_STAGE_MSG[stage]} started")
            else:
                emit(
                    "stage_completed", stage, f"{_STAGE_MSG[stage]} completed",
                    data=_progress_data(stage, payload, calls()),
                )

        validation = validate_project(
            out_dir, install=install, run_bundle=run_bundle, on_progress=on_progress
        )

        # --- STAGE: repair (only when validation failed AND AI is available) ---
        repair_rounds = 0
        if not validation.passed and counter is not None:
            current_stage = "repair"
            emit("stage_started", "repair", "Repairing residue errors with the LLM")

            def on_round(rnd: int, max_rounds: int, attempts: int, passed: bool) -> None:
                nonlocal repair_rounds
                repair_rounds = rnd
                emit(
                    "stage_completed", "repair", f"Repair round {rnd} of {max_rounds}",
                    data=MigrationEventData(
                        repairRound=rnd, maxRepairRounds=max_rounds,
                        repairAttempts=attempts, passed=passed, llmCalls=calls(),
                    ),
                )

            rep = repair_project(
                out_dir, emission, validation, provider=counter,
                source_root=source_root, run_bundle=run_bundle, on_round=on_round,
            )
            validation = rep.validation or validation
            repair_rounds = rep.rounds

        # --- scores + terminal result ---
        mapped = map_diagnostics(validation, emission, source_root=source_root)
        scores = validated_scores(
            emission, validation,
            predicted_coverage=report.coverage, predicted_confidence=report.confidence,
        )
        result = MigrationResult(
            runId=run_id,
            validationPassed=validation.passed,
            typecheckPassed=validation.typecheck.passed,
            bundlePassed=validation.bundle.passed,
            bundleRan=validation.bundle.ran,
            llmCalls=calls(),
            repairRounds=repair_rounds,
            filesConverted=files_converted,
            todoCount=emission.todoCount,
            navigatorShape=navigator_shape,
            durationSeconds=round(time.monotonic() - started, 2),
            validatedScores=scores,
            report=report, plan=plan, emission=emission,
            validation=validation, mappedDiagnostics=mapped,
        )
        emit("succeeded", "done", "Migration complete", result=result)
        return result

    except Exception as exc:  # surface a structured, honest failure
        emit(
            "failed", current_stage, f"Migration failed during {current_stage}: {exc}",
            error=MigrationError(
                type=type(exc).__name__, message=str(exc),
                stage=current_stage,  # type: ignore[arg-type]
            ),
        )
        raise
