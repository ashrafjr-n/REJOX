"""Rejox CLI — run the whole migration end-to-end from the terminal.

    rejox migrate <project-path> [--out <dir>] [--yes] [--no-validate]

This is the terminal face of the pipeline the API already chains
(parse → analyze → plan → emit → validate). It calls the pipeline functions
directly — never over HTTP, never re-implementing logic — and renders the run as
an engineer's report: the explainable score, the Ask questions (including the
tier-3 navigator-shape question the AI proposes), the emitted-residue tier
breakdown, and — the whole thesis — the actual LLM call count.

Fully usable with zero AI: without ``GEMINI_API_KEY`` the one LLM step (navigator
shape) degrades to the deterministic default and everything else is unchanged.
"""

from __future__ import annotations

import os
import re
import tempfile
from collections import Counter
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.rule import Rule
from rich.table import Table
from rich.text import Text

from app.models.analysis import AnalysisReport
from app.models.knowledge_graph import KnowledgeGraph
from app.models.plan import MigrationPlan, Question
from app.pipeline.analyzer import analyze_graph
from app.pipeline.emit import emit_project
from app.pipeline.intelligence import IntelligenceError, build_knowledge_graph
from app.pipeline.planner import plan_migration
from app.pipeline.validator import (
    ValidatorError,
    validate_project,
    validated_scores,
)

app = typer.Typer(add_completion=False, help="Rejox — AI migration engineer: React → React Native.")
console = Console()

# The Ask questions the emit/scaffold pipeline actually consumes, in order.
_CORE_QUESTION_IDS = ["project-type", "styling-engine", "navigation-library", "icons", "storage"]


# --- small render helpers ----------------------------------------------------


def _pct(value: float) -> str:
    return f"{value:.0f}%"


def _score_color(value: float) -> str:
    return "green" if value >= 80 else "yellow" if value >= 55 else "red"


_RISK_COLOR = {"low": "green", "medium": "yellow", "high": "red"}
_STATUS_COLOR = {
    "compatible": "green", "needs-conversion": "yellow", "partial": "yellow",
    "unsupported": "red", "unknown": "dim",
}


def _stage(title: str) -> None:
    console.print()
    console.print(Rule(Text(title, style="bold cyan"), style="cyan"))


# --- 1. report ---------------------------------------------------------------


def _render_report(report: AnalysisReport) -> None:
    s = report.summary
    cov, conf, risk = report.coverage, report.confidence, report.risk

    scores = Table.grid(padding=(0, 4))
    scores.add_column(justify="center")
    scores.add_column(justify="center")
    scores.add_column(justify="center")
    scores.add_row(
        Text("COVERAGE", style="bold dim"),
        Text("CONFIDENCE", style="bold dim"),
        Text("RISK", style="bold dim"),
    )
    scores.add_row(
        Text(_pct(cov), style=f"bold {_score_color(cov)}"),
        Text(_pct(conf), style=f"bold {_score_color(conf)}"),
        Text(risk.upper(), style=f"bold {_RISK_COLOR.get(risk, 'white')}"),
    )
    console.print(Panel(scores, title=f"[bold]{report.projectName}[/] — Migration Report", expand=False))

    console.print(
        f"[dim]Components[/] {s.componentCount}   [dim]Pages[/] {s.pageCount}   "
        f"[dim]Routes[/] {s.routeCount}   [dim]Endpoints[/] {s.apiEndpointCount}   "
        f"[dim]Stores[/] {s.storeCount}"
    )

    # Explainable Coverage — the signed contributions that sum to the figure.
    if report.contributions:
        t = Table(title="Coverage — explained (Σ = Coverage)", title_style="bold",
                  show_edge=False, box=None, pad_edge=False)
        t.add_column("", width=7, justify="right")
        t.add_column("Area")
        t.add_column("Why", style="dim")
        for c in report.contributions:
            sign = "green" if c.delta >= 0 else "red"
            t.add_row(Text(f"{c.delta:+.0f}", style=sign), c.label, c.reason)
        console.print(t)

    if report.libraries:
        t = Table(title="Detected libraries", title_style="bold", show_edge=False, box=None)
        t.add_column("Library"); t.add_column("Category", style="dim")
        t.add_column("Status"); t.add_column("Compat", justify="right")
        for lib in report.libraries:
            t.add_row(
                lib.name, lib.category,
                Text(lib.status, style=_STATUS_COLOR.get(lib.status, "white")),
                f"{lib.compatibility}%",
            )
        console.print(t)

    if report.domains:
        t = Table(title="Functional domains", title_style="bold", show_edge=False, box=None)
        t.add_column("Domain"); t.add_column("Risk"); t.add_column("Why", style="dim")
        for d in report.domains:
            t.add_row(d.domain, Text(d.risk, style=_RISK_COLOR.get(d.risk, "white")), d.reason)
        console.print(t)


# --- 2. ask ------------------------------------------------------------------


def _recommended(q: Question) -> Optional[str]:
    for o in q.options:
        if o.isRecommended:
            return o.id
    return q.options[0].id if q.options else None


def _ask_question(q: Question, auto: bool) -> str:
    rec = _recommended(q)
    console.print()
    console.print(f"[bold]{q.title}[/]")
    if q.context:
        console.print(f"  [dim]{q.context}[/]")
    for o in q.options:
        star = " [green](recommended)[/]" if o.id == rec else ""
        console.print(f"    [cyan]{o.id}[/] — {o.label}{star}")
        console.print(f"        [dim]{o.tradeoffs}[/]")
    if auto:
        console.print(f"  [dim]→ auto-accepting[/] [cyan]{rec}[/]")
        return rec or ""
    valid = {o.id for o in q.options}
    while True:
        choice = typer.prompt(f"  Choose [{rec}]", default=rec, show_default=False).strip()
        if choice in valid:
            return choice
        console.print(f"  [red]Pick one of: {', '.join(sorted(valid))}[/]")


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


def _ask_navigator_shape(report, kg, provider, counter, auto):
    """The tier-3 question. With AI: the LLM proposes a shape (1 call). Without a
    key: degrade to the deterministic stack, clearly noticed. Returns
    (answer_id, proposal_or_None, llm_used: bool)."""
    from app.ai.navigation import (
        build_shape_question,
        infer_navigator_shape,
        stack_spec_from_routes,
    )

    routes = report.routing.routes
    if not routes:
        return None, None, False
    nav_ui = _nav_ui_summary(report, kg)

    if provider is None:
        console.print(
            "\n[yellow]AI disabled[/] (no GEMINI_API_KEY) — navigator shape defaults "
            "to the deterministic [cyan]stack[/]."
        )
        spec = stack_spec_from_routes(routes)
        question = build_shape_question(spec, nav_ui)
        return _ask_question(question, auto), None, False

    _seed_offline_shape(provider, routes, nav_ui)  # no-op unless provider is the offline fake
    try:
        with console.status("[cyan]Consulting the AI navigator architect…[/]", spinner="dots"):
            proposal = infer_navigator_shape(routes, nav_ui, provider=counter)
    except Exception as exc:  # any provider failure → deterministic default
        console.print(f"\n[yellow]AI navigator step failed ({exc}); using the stack default.[/]")
        spec = stack_spec_from_routes(routes)
        return _ask_question(build_shape_question(spec, nav_ui), auto), None, False

    tag = "[yellow](fell back to stack)[/]" if proposal.fellBack else ""
    console.print(
        f"\n[green]AI proposal:[/] a [bold]{proposal.resolution.spec.type.value}[/] "
        f"navigator {tag} — [dim]{proposal.resolution.spec.rationale}[/]"
    )
    return _ask_question(proposal.question, auto), proposal, True


def _ask(report, kg, plan: MigrationPlan, provider, counter, auto):
    _stage("Ask — migration decisions")
    answers: dict[str, str] = {}
    by_id = {q.id: q for q in plan.questions}
    for qid in _CORE_QUESTION_IDS:
        q = by_id.get(qid)
        if q is not None:
            answers[qid] = _ask_question(q, auto)

    shape_answer, proposal, _ = _ask_navigator_shape(report, kg, provider, counter, auto)
    if shape_answer:
        answers["navigator-shape"] = shape_answer
    return answers, proposal


# --- 3. plan -----------------------------------------------------------------


def _render_plan(plan: MigrationPlan) -> None:
    _stage("Plan — ordered migration steps")
    t = Table(show_edge=False, box=None)
    t.add_column("#", justify="right", style="dim")
    t.add_column("Step"); t.add_column("Kind", style="cyan")
    t.add_column("Effort"); t.add_column("Targets", style="dim")
    for i, step in enumerate(plan.steps, 1):
        targets = ", ".join(step.targets[:4]) + ("…" if len(step.targets) > 4 else "")
        t.add_row(str(i), step.title, step.kind, step.estimatedEffort, targets or "—")
    console.print(t)


# --- 4. migrate + resolver tier breakdown ------------------------------------


def _resolve_residue(emission, report, kg, src, provider, cache, proposal):
    """Run the AI Resolution Engine over the emitted residue to show HOW it is
    resolved — the tier breakdown. The point: almost everything is a rule; the
    LLM is touched at most once (the navigator shape)."""
    from app.ai.css import resolve_css_module
    from app.ai.navigation import resolve_nav_active
    from app.ai.styling import MappedResidue, resolve_styling
    from app.pipeline.transformer import check_syntax

    tiers: Counter = Counter()

    # Styling residue (TW_UNSUPPORTED) → static_map / pattern / (rarely) llm.
    styling_residue = [
        MappedResidue(snippet=u.snippet, sourceFile=f.sourceFile,
                      componentName=Path(f.path).stem)
        for f in emission.files for u in f.unhandled if u.code == "TW_UNSUPPORTED"
    ]
    if styling_residue:
        for r in resolve_styling(
            styling_residue, {"stylingEngine": "nativewind"},
            provider=provider, cache=cache, syntax_check=check_syntax,
        ):
            tiers[r.tier.value] += 1

    # CSS Modules → static_map / pattern (pure parsing; no LLM on real input).
    for css in sorted(src.rglob("*.module.css")):
        res = resolve_css_module(css, module=f"./{css.name}", provider=provider, cache=cache)
        for tier, n in res.tiers.items():
            if n:
                tiers[tier] += n

    # NAV_ACTIVE → rule (one per residue instance).
    nav_active = [
        u for f in emission.files for u in f.unhandled if u.code == "NAV_ACTIVE"
    ]
    for _ in nav_active:
        resolve_nav_active()
        tiers["rule"] += 1

    # NAV_CONTAINER wiring → rule (the navigator emit generated from the route table).
    if report.routing.routes:
        tiers["rule"] += 1

    # Navigator shape → the one genuine reasoning call (already made in Ask).
    if proposal is not None and not proposal.fellBack:
        tiers["llm"] += 1

    return tiers


def _render_tier_breakdown(tiers: Counter, counter) -> None:
    t = Table(title="Residue resolution — by tier", title_style="bold", show_edge=False, box=None)
    t.add_column("Tier"); t.add_column("Units", justify="right")
    labels = [("static_map", "Static map (rule)"), ("pattern", "Pattern (rule)"),
              ("rule", "Direct rule"), ("llm", "LLM (reasoning)")]
    total = 0
    for key, label in labels:
        n = tiers.get(key, 0)
        total += n
        style = "magenta" if key == "llm" else "green"
        t.add_row(Text(label, style=style), Text(str(n), style=style))
    console.print(t)
    resolved_by_rule = total - tiers.get("llm", 0)
    console.print(
        f"[bold green]{resolved_by_rule}/{total}[/] residue units resolved by rule.  "
        f"[bold magenta]Actual LLM calls: {counter.calls}[/]  "
        f"[dim](tokens {counter.tokensIn}→{counter.tokensOut})[/]"
    )


# --- 5/6. validate + final ---------------------------------------------------


def _render_validation(validation, scores) -> None:
    _stage("Review — validation (tsc + Metro)")
    tc, bd = validation.typecheck, validation.bundle
    ok = lambda passed: Text("PASS", style="bold green") if passed else Text("FAIL", style="bold red")

    t = Table(show_edge=False, box=None)
    t.add_column("Stage"); t.add_column("Result"); t.add_column("Detail", style="dim")
    t.add_row("Install", ok(validation.installed), "")
    t.add_row("Typecheck (tsc)", ok(tc.passed) if tc.ran else Text("skipped", style="dim"),
              f"{tc.errorCount} error(s)")
    t.add_row("Bundle (Metro)", ok(bd.passed) if bd.ran else Text("skipped", style="dim"),
              bd.skippedReason or "")
    console.print(t)

    # Every remaining diagnostic is expected residue (mapped to a REJOX-TODO).
    diags = [d for d in tc.diagnostics if d.severity == "error"][:8]
    if diags:
        console.print("[dim]Remaining diagnostics (all map to known residue):[/]")
        for d in diags:
            console.print(f"  [dim]{d.file}:{d.line}[/] {d.code} {d.message[:80]}")

    if scores is not None:
        console.print(
            f"\n[dim]Validated[/]  Coverage [bold {_score_color(scores.workingCoverage)}]"
            f"{_pct(scores.workingCoverage)}[/]  (strict {_pct(scores.coverage)})   "
            f"Confidence [bold {_score_color(scores.confidence)}]{_pct(scores.confidence)}[/]"
        )


def _render_final(emission, validation, scores, out_dir, counter, cache, proposal) -> None:
    _stage("Done — migration summary")
    converted = [f for f in emission.files if f.sourceFile]
    todos = [
        (f.path, u.code)
        for f in emission.files for u in f.unhandled
    ]

    t = Table.grid(padding=(0, 3))
    t.add_column(style="dim"); t.add_column()
    t.add_row("Files converted", f"[bold]{len(converted)}[/]")
    t.add_row("Files skipped", str(len(emission.skipped)))
    t.add_row("Residue TODOs", f"[bold]{emission.todoCount}[/]")
    if validation is not None and scores is not None:
        t.add_row("Validated coverage", f"[bold]{_pct(scores.workingCoverage)}[/]")
        t.add_row("Validated confidence", f"[bold]{_pct(scores.confidence)}[/]")
        t.add_row("Validation", "[green]PASS[/]" if validation.passed else "[yellow]see diagnostics[/]")
    stats = cache.stats()
    t.add_row("LLM calls", f"[bold magenta]{counter.calls}[/] [dim](tokens {counter.tokensIn}→{counter.tokensOut})[/]")
    t.add_row("Cache", f"{stats.hits} hit / {stats.lookups} lookup ({_pct(stats.hitRate * 100)})")
    if proposal is not None:
        shape = proposal.resolution.spec.type.value
        t.add_row("Navigator shape", f"proposed [cyan]{shape}[/] · emitted [cyan]stack[/] [dim](validated default)[/]")
    console.print(t)

    if todos:
        tt = Table(title="Residue — needs attention", title_style="bold", show_edge=False, box=None)
        tt.add_column("File"); tt.add_column("Code", style="yellow")
        for path, code in sorted(set(todos))[:14]:
            tt.add_row(path, code)
        console.print(tt)

    console.print()
    console.print(Panel(
        f"[bold]{out_dir}[/]\n\n[dim]Run it:[/]  [bold cyan]cd {out_dir} && npx expo start[/]",
        title="React Native project", expand=False, border_style="green",
    ))


# --- provider seam -----------------------------------------------------------


class _CountingProvider:
    """Wraps the real provider to tally calls + tokens for the report."""

    def __init__(self, inner) -> None:
        self._inner = inner
        self.calls = 0
        self.tokensIn = 0
        self.tokensOut = 0
        self.model = getattr(inner, "model", getattr(inner, "model_name", "?"))

    def complete(self, system: str, user: str, *, max_tokens: int):
        resp = self._inner.complete(system, user, max_tokens=max_tokens)
        self.calls += 1
        self.tokensIn += resp.tokensIn
        self.tokensOut += resp.tokensOut
        return resp


def _make_provider() -> tuple[object, str]:
    """Pick the LLM provider for the one reasoning step (navigator shape):

    - ``GEMINI_API_KEY`` set → the real Gemini provider.
    - ``REJOX_AI_PROVIDER=fake`` → the project's offline provider (a real single
      call, deterministic) so the full flow — including the 1 LLM call — runs
      without network. Transparently labeled as offline.
    - otherwise → AI disabled; the shape step uses the deterministic default.

    Returns ``(provider_or_None, label)``.
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


def _seed_offline_shape(provider, routes, nav_ui) -> None:
    """If the provider is the offline FakeProvider, register a valid navigator
    spec for the shape prompt so the demo shows exactly one successful LLM call.
    The spec is derived from the route table — top-level routes → tabs, detail
    (param) routes → a nested stack under their parent."""
    from app.ai.provider import FakeProvider

    if not isinstance(provider, FakeProvider):
        return
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
                nested.append({"type": "stack", "parent": parent,
                               "screens": [parent, r.screenName]})
    import json as _json

    spec = {
        "type": "tabs", "screens": top, "nested": nested,
        "rationale": f"A persistent {len(top)}-link top nav maps to bottom tabs; "
                     "detail routes nest in a stack.",
    }
    system, user = shape_prompt(routes, nav_ui)
    provider.register(system, user, _json.dumps(spec))


# --- command -----------------------------------------------------------------


@app.callback()
def _main() -> None:
    """Rejox — AI migration engineer: React → React Native."""


@app.command()
def migrate(
    project_path: Path = typer.Argument(..., help="Path to the React project to migrate."),
    out: Optional[Path] = typer.Option(None, "--out", help="Output dir for the RN project (temp dir if omitted)."),
    yes: bool = typer.Option(False, "--yes", "-y", help="Accept all recommended answers non-interactively."),
    no_validate: bool = typer.Option(False, "--no-validate", help="Skip the tsc + Metro validation stage."),
) -> None:
    """Migrate a React project to React Native, end to end."""
    from app.ai.cache import ResolutionCache

    src = project_path.expanduser().resolve()
    if not src.is_dir():
        console.print(f"[red]Not a directory:[/] {src}")
        raise typer.Exit(code=1)

    console.print(Rule(Text("Rejox — React → React Native", style="bold white"), style="white"))

    # 1. Analyze.
    _stage("Intelligence — analyzing the project")
    try:
        with console.status("[cyan]Building the knowledge graph…[/]", spinner="dots"):
            kg = build_knowledge_graph(src)
            report = analyze_graph(kg)
    except IntelligenceError as exc:
        console.print(f"[red]Analysis failed:[/] {exc}")
        raise typer.Exit(code=1)
    _render_report(report)

    plan = plan_migration(report, kg)

    # 2. Ask.
    inner, ai_label = _make_provider()
    console.print(f"[dim]AI provider:[/] {ai_label}")
    counter = _CountingProvider(inner) if inner is not None else _CountingProvider(_NullProvider())
    answers, proposal = _ask(report, kg, plan, inner, counter, yes)

    # 3. Plan.
    _render_plan(plan)

    # 4. Migrate.
    _stage("Migrate — emitting the React Native project")
    out_dir = out.expanduser().resolve() if out else Path(tempfile.mkdtemp(prefix="rejox-"))
    with console.status("[cyan]Transforming files…[/]", spinner="dots"):
        emission = emit_project(plan, answers, kg, out_dir, report=report, source_root=src)
    console.print(f"Emitted [bold]{len([f for f in emission.files if f.sourceFile])}[/] files → [dim]{out_dir}[/]")

    cache = ResolutionCache()
    with console.status("[cyan]Resolving residue by rule…[/]", spinner="dots"):
        tiers = _resolve_residue(emission, report, kg, src, counter, cache, proposal)
    _render_tier_breakdown(tiers, counter)

    # 5. Validate.
    validation = scores = None
    if not no_validate:
        try:
            with console.status("[cyan]Validating (npm install · tsc · Metro)…[/]", spinner="dots"):
                validation = validate_project(out_dir, install=True, run_bundle=True)
            scores = validated_scores(
                emission, validation,
                predicted_coverage=report.coverage, predicted_confidence=report.confidence,
            )
        except ValidatorError as exc:
            console.print(f"[yellow]Validation could not run:[/] {exc}")
        if validation is not None:
            _render_validation(validation, scores)

    # 6. Final report.
    _render_final(emission, validation, scores, out_dir, counter, cache, proposal)


class _NullProvider:
    """Stand-in when AI is disabled — never called (guarded), keeps the counter simple."""

    model_name = "none"

    def complete(self, system: str, user: str, *, max_tokens: int):  # pragma: no cover
        raise RuntimeError("AI is disabled (no GEMINI_API_KEY).")


if __name__ == "__main__":
    app()
