"""The repair loop — the last, honest resort.

After emit → validate, most errors are already gone (the resolvers ran in emit).
Anything left that maps to a *resolvable* residue code gets one targeted LLM
repair: we send ONLY the offending line + its diagnostic (never the whole file),
apply the returned line, and re-validate. At most two rounds, then we stop and
report honestly.

Provenance is truthful: a file the LLM touched that then validates is
``ai-validated`` (65); one that still fails is ``ai-failed`` (0). Every attempt
is logged — what error, what was sent, what came back, and whether it fixed it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

# Fired after each completed repair round: on_round(round, maxRounds, attempts, passed).
# Optional so sync callers (CLI, tests) are unaffected.
RoundFn = Callable[[int, int, int, bool], None]

from app.ai.provider import LLMProvider
from app.models.analysis import ConfidenceSource
from app.models.emission import EmittedProject
from app.models.validation import MappedDiagnostic, ValidationResult
from app.pipeline.validator import map_diagnostics, validate_project

MAX_REPAIR_ROUNDS = 2
_REPAIR_MAX_TOKENS = 400
_FENCE_RE = re.compile(r"^```[a-zA-Z0-9]*\n?|\n?```$", re.MULTILINE)

# Residue codes the repair loop is allowed to touch. An *unexplained* diagnostic
# (no residue) is a codemod bug — we do NOT paper over it with the LLM.
_RESOLVABLE_CODES = {
    "NAV_LINK", "NAV_ACTIVE", "NAV_HOOK", "CSS_MODULE", "TW_UNSUPPORTED",
    "EVENT_ADAPTER", "FORM_SUBMIT", "PROPS_HTML_TYPE",
}


@dataclass
class RepairAttempt:
    round: int
    file: str
    line: int
    diagnostic: str          # e.g. "TS2322 Type '…' is not assignable…"
    residueCode: str
    sent: str                # the exact line handed to the LLM
    received: str            # the LLM's replacement line
    fixed: bool = False      # did re-validation clear this file's errors?


@dataclass
class RepairResult:
    rounds: int = 0
    attempts: list[RepairAttempt] = field(default_factory=list)
    passed: bool = False
    validation: Optional[ValidationResult] = None
    stoppedReason: str = ""


def _repairable(m: MappedDiagnostic) -> bool:
    return (
        m.diagnostic.severity == "error"
        and bool(m.diagnostic.file)
        and m.diagnostic.line is not None
        and bool(set(m.nearbyTodo) & _RESOLVABLE_CODES)
    )


def _build_prompt(m: MappedDiagnostic, line_text: str) -> tuple[str, str]:
    residue = next((c for c in m.nearbyTodo if c in _RESOLVABLE_CODES), "?")
    system = (
        "You repair ONE line of React Native code that failed type-check or "
        "bundling. Output ONLY the corrected line — valid TS/JSX, no prose, no "
        "markdown fences, no extra lines. If you cannot fix it, return the line "
        "unchanged."
    )
    user = (
        f"Error: {m.diagnostic.code or ''} {m.diagnostic.message}\n"
        f"Residue: {residue}\n"
        f"Line {m.diagnostic.line}:\n{line_text}"
    )
    return system, user


def _apply_line(path: Path, line_no: int, new_line: str) -> None:
    lines = path.read_text().splitlines()
    if 1 <= line_no <= len(lines):
        lines[line_no - 1] = new_line
        path.write_text("\n".join(lines) + "\n")


def repair_project(
    out_dir: Path | str,
    emitted: EmittedProject,
    validation: ValidationResult,
    *,
    provider: Optional[LLMProvider],
    source_root: Optional[Path | str] = None,
    max_rounds: int = MAX_REPAIR_ROUNDS,
    run_bundle: bool = True,
    on_round: Optional[RoundFn] = None,
) -> RepairResult:
    """Run up to ``max_rounds`` targeted LLM repairs; re-validate after each.

    ``on_round`` (optional) is fired once per completed round with the real
    counts ``(round, maxRounds, attemptsThisRound, passed)`` so the job layer
    can emit a truthful per-round event.
    """
    out_dir = Path(out_dir)
    result = RepairResult(validation=validation, passed=validation.passed)
    if validation.passed:
        result.stoppedReason = "validation already passed — no repair needed"
        return result
    if provider is None:
        result.stoppedReason = "AI disabled (no provider) — cannot run LLM repair"
        return result

    repaired_files: set[str] = set()
    current = validation
    for rnd in range(1, max_rounds + 1):
        mapped = map_diagnostics(current, emitted, source_root=source_root)
        targets = [m for m in mapped if _repairable(m)]
        if not targets:
            result.stoppedReason = "no remaining errors map to a resolvable residue code"
            break

        # One repair per (file, line) per round.
        seen: set[tuple[str, int]] = set()
        touched = False
        for m in targets:
            key = (m.diagnostic.file, m.diagnostic.line)  # type: ignore[arg-type]
            if key in seen:
                continue
            seen.add(key)
            fp = out_dir / m.diagnostic.file  # type: ignore[operator]
            if not fp.is_file():
                continue
            lines = fp.read_text().splitlines()
            line_text = lines[m.diagnostic.line - 1] if m.diagnostic.line <= len(lines) else ""  # type: ignore[operator]
            system, user = _build_prompt(m, line_text)
            resp = provider.complete(system, user, max_tokens=_REPAIR_MAX_TOKENS)
            new_line = _FENCE_RE.sub("", resp.text).strip().splitlines()
            new_line_text = new_line[0] if new_line else line_text
            attempt = RepairAttempt(
                round=rnd, file=m.diagnostic.file,  # type: ignore[arg-type]
                line=m.diagnostic.line,  # type: ignore[arg-type]
                diagnostic=f"{m.diagnostic.code or ''} {m.diagnostic.message}".strip(),
                residueCode=next((c for c in m.nearbyTodo if c in _RESOLVABLE_CODES), "?"),
                sent=line_text, received=new_line_text,
            )
            result.attempts.append(attempt)
            if new_line_text and new_line_text != line_text:
                _apply_line(fp, m.diagnostic.line, new_line_text)  # type: ignore[arg-type]
                repaired_files.add(m.diagnostic.file)  # type: ignore[arg-type]
                touched = True

        result.rounds = rnd
        current = validate_project(out_dir, install=False, run_bundle=run_bundle)
        result.validation = current
        result.passed = current.passed
        # Mark which attempts led to a clean file.
        clean_files = {
            m.file for m in map_diagnostics(current, emitted, source_root=source_root)
            if m.diagnostic.severity == "error"
        }
        for a in result.attempts:
            a.fixed = a.file not in clean_files
        if on_round is not None:
            attempts_this_round = sum(1 for a in result.attempts if a.round == rnd)
            on_round(rnd, max_rounds, attempts_this_round, current.passed)
        if current.passed:
            result.stoppedReason = "validation passed after repair"
            break
        if not touched:
            result.stoppedReason = "LLM returned no change — nothing more to try"
            break
    else:
        result.stoppedReason = f"reached max {max_rounds} repair round(s)"

    # Stamp provenance for every file the LLM touched.
    final_errors = {
        m.file for m in map_diagnostics(current, emitted, source_root=source_root)
        if m.diagnostic.severity == "error"
    }
    for f in emitted.files:
        if f.path in repaired_files:
            f.provenance = (
                ConfidenceSource.AI_FAILED if f.path in final_errors
                else ConfidenceSource.AI_VALIDATED
            )
    return result
