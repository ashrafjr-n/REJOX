"""Scoring rules — Coverage, Confidence, and the explainable breakdown.

The old single ``migrationScore`` conflated two independent axes and was
therefore dishonest. They are computed separately now:

**Coverage (0-100)** — how much of the project can be migrated. Built as a
list of :class:`ScoreContribution` rows whose signed deltas sum EXACTLY to the
figure (base 0):

    area budgets (positive rows grant them):   components 40 · libraries 25 ·
                                               styling 20 · routing 10 · api 5
    deductions (negative rows):
      components: each component's shortfall (100 − score), attributed to its
                  issue codes proportionally to severity penalties, scaled by
                  40/(100·N) — so Σ rows ≡ 40·mean(score)/100.
      libraries : each library is its own positive row, 25·compat/(100·M).
      styling   : −20·penalty·count/100 per styling code (see _STYLING_PENALTY).
      routing   : −2 for a web router present; −2 per unparsed object router.
      api       : −0.5 per endpoint whose URL could not be read statically.

**Confidence (0-100)** — how sure we are that what WAS migrated is correct.
Computed from provenance only (see ``PROVENANCE_BY_CODE`` and
``CONFIDENCE_BY_SOURCE``): deterministic rule = 100, deterministic + warning =
80, AI-resolved (reserved) = 65/0. Residue (``unhandled``) is EXCLUDED — it
counts against Coverage instead, because it was not migrated at all. Every
component also contributes one baseline deterministic unit: the mechanical
majority (tags, events, text wrapping, imports) is rule-resolved.

Per-component difficulty/score is unchanged; it feeds the components area.
"""

from __future__ import annotations

from collections import defaultdict

from app.models.analysis import (
    CONFIDENCE_BY_SOURCE,
    ComponentFinding,
    ConfidenceSource,
    Difficulty,
    LibraryFinding,
    RoutingReport,
    ScoreContribution,
)
from app.models.knowledge_graph import KnowledgeGraph

from . import codes

# --- Component scoring (unchanged) -------------------------------------------

SEVERITY_PENALTY = {"info": 2, "warning": 10, "blocker": 40}
_BLOCKED_CAP = 20


def score_component(issues) -> tuple[int, Difficulty]:
    """Compute (score, difficulty) for a component from its issues."""
    penalty = sum(SEVERITY_PENALTY[i.severity] for i in issues)
    if any(i.severity == "blocker" for i in issues):
        return max(0, min(100 - penalty, _BLOCKED_CAP)), "blocked"

    score = max(0, 100 - penalty)
    if score >= 90:
        difficulty: Difficulty = "trivial"
    elif score >= 75:
        difficulty = "easy"
    elif score >= 55:
        difficulty = "medium"
    else:
        difficulty = "hard"
    return score, difficulty


# --- Confidence provenance ----------------------------------------------------

# What the Deterministic Transformer actually does with each finding today.
# Codes absent from this map are treated as UNHANDLED (conservative).
PROVENANCE_BY_CODE: dict[str, ConfidenceSource] = {
    # Resolved silently by rules → 100.
    codes.ELEMENT_CONVERSION: ConfidenceSource.DETERMINISTIC,
    codes.EVENT_CONVERSION: ConfidenceSource.DETERMINISTIC,
    codes.MISSING_TEXT_WRAP: ConfidenceSource.DETERMINISTIC,
    codes.IMPLICIT_FLEX_ROW: ConfidenceSource.DETERMINISTIC,  # flex-row appended
    # Resolved by rules but flagged for review → 80.
    codes.WEB_ONLY_EVENT: ConfidenceSource.DETERMINISTIC_WARNING,  # dropped + warning
    codes.UNSIZED_IMAGE: ConfidenceSource.DETERMINISTIC_WARNING,   # placeholder + TODO
    codes.RESPONSIVE_BREAKPOINT: ConfidenceSource.DETERMINISTIC_WARNING,  # needs config
    codes.INTERACTION_STATE: ConfidenceSource.DETERMINISTIC_WARNING,      # partial in RN
    codes.ROUTER_NEEDS_CONVERSION: ConfidenceSource.DETERMINISTIC_WARNING,  # links/hooks rule-resolved; navigator wiring reviewed
    # Residue — not migrated; excluded from Confidence, penalizes Coverage.
    codes.HOVER_STATE: ConfidenceSource.UNHANDLED,
    codes.CSS_GRID: ConfidenceSource.UNHANDLED,
    codes.GROUP_SELECTOR: ConfidenceSource.UNHANDLED,
    codes.GRADIENT: ConfidenceSource.UNHANDLED,
    codes.CSS_MODULE: ConfidenceSource.UNHANDLED,
    codes.DYNAMIC_CLASSNAME: ConfidenceSource.UNHANDLED,
    codes.WEB_API_USAGE: ConfidenceSource.UNHANDLED,
    codes.WEB_ONLY_ELEMENT: ConfidenceSource.UNHANDLED,
    codes.RN_INCOMPATIBLE_CSS_PROP: ConfidenceSource.UNHANDLED,
    codes.UNSUPPORTED_LIBRARY: ConfidenceSource.UNHANDLED,
    codes.UNKNOWN_LIBRARY: ConfidenceSource.UNHANDLED,
    codes.OBJECT_ROUTER_UNPARSED: ConfidenceSource.UNHANDLED,
}


def compute_confidence(findings: list[ComponentFinding]) -> float:
    """Provenance-weighted mean over migrated units (residue excluded).

    A blocked component is not migrated at all, so it contributes NO units —
    its shortfall is Coverage's business, not Confidence's.
    """
    values: list[int] = []
    for finding in findings:
        if finding.difficulty == "blocked":
            continue
        # Baseline: the component's mechanical conversion is rule-resolved.
        values.append(100)
        for issue in finding.issues:
            source = PROVENANCE_BY_CODE.get(issue.code, ConfidenceSource.UNHANDLED)
            value = CONFIDENCE_BY_SOURCE[source]
            if value is not None:
                values.append(value)
    if not values:
        return 100.0
    return round(sum(values) / len(values), 1)


# --- Coverage contributions ----------------------------------------------------

AREA_BUDGETS = {
    "components": 40.0,
    "libraries": 25.0,
    "styling": 20.0,
    "routing": 10.0,
    "api": 5.0,
}

# Human labels for deduction rows, per issue code.
_CODE_LABELS = {
    codes.WEB_ONLY_ELEMENT: "Web-only elements",
    codes.ELEMENT_CONVERSION: "Element conversions",
    codes.WEB_ONLY_EVENT: "Web-only events",
    codes.EVENT_CONVERSION: "Event conversions",
    codes.HOVER_STATE: "Hover styling",
    codes.INTERACTION_STATE: "Focus/active styling",
    codes.CSS_GRID: "CSS grid layout",
    codes.RESPONSIVE_BREAKPOINT: "Responsive breakpoints",
    codes.GRADIENT: "Gradient backgrounds",
    codes.GROUP_SELECTOR: "Group selectors",
    codes.DYNAMIC_CLASSNAME: "Runtime class names",
    codes.CSS_MODULE: "CSS Modules",
    codes.MISSING_TEXT_WRAP: "Bare text wrapping",
    codes.IMPLICIT_FLEX_ROW: "Implicit flex direction",
    codes.UNSIZED_IMAGE: "Unsized images",
    codes.RN_INCOMPATIBLE_CSS_PROP: "RN-incompatible inline CSS",
    codes.WEB_API_USAGE: "Browser API usage",
}

# Per-component styling-issue penalties (points off the styling area).
_STYLING_PENALTY = {
    codes.CSS_GRID: 3,
    codes.HOVER_STATE: 2,
    codes.RESPONSIVE_BREAKPOINT: 1,
    codes.GRADIENT: 2,
    codes.GROUP_SELECTOR: 2,
    codes.CSS_MODULE: 4,
    codes.DYNAMIC_CLASSNAME: 5,
}


def _round(value: float) -> float:
    return round(value, 2)


def _components_rows(findings: list[ComponentFinding]) -> list[ScoreContribution]:
    budget = AREA_BUDGETS["components"]
    n = len(findings)
    rows = [
        ScoreContribution(
            label="Functional components",
            delta=_round(budget),
            reason=(
                f"All {n} components use the MVP-supported functional architecture "
                "(no class components); the mechanical majority converts by rule."
            ),
            evidence=f"{n} component(s) in the Knowledge Graph",
        )
    ]
    if n == 0:
        return rows

    # Attribute each component's shortfall (100 − score) to its issue codes,
    # proportionally to severity penalties — the blocked-cap case folds in
    # naturally because the shortfall is derived from the FINAL score.
    shortfall_by_code: dict[str, float] = defaultdict(float)
    components_by_code: dict[str, set[str]] = defaultdict(set)
    for finding in findings:
        shortfall = 100.0 - finding.score
        if shortfall <= 0 or not finding.issues:
            continue
        raw_total = sum(SEVERITY_PENALTY[i.severity] for i in finding.issues)
        for issue in finding.issues:
            share = shortfall * SEVERITY_PENALTY[issue.severity] / raw_total
            shortfall_by_code[issue.code] += share
            components_by_code[issue.code].add(finding.name)

    scale = budget / (100.0 * n)
    for code in sorted(shortfall_by_code):
        delta = -shortfall_by_code[code] * scale
        names = sorted(components_by_code[code])
        listed = ", ".join(names[:4]) + ("…" if len(names) > 4 else "")
        rows.append(
            ScoreContribution(
                label=_CODE_LABELS.get(code, code),
                delta=_round(delta),
                reason=f"{code} reduces per-component convertibility.",
                evidence=f"{len(names)} component(s): {listed}",
            )
        )
    return rows


def _library_rows(findings: list[LibraryFinding]) -> list[ScoreContribution]:
    budget = AREA_BUDGETS["libraries"]
    if not findings:
        return [
            ScoreContribution(
                label="No external dependencies",
                delta=_round(budget),
                reason="Nothing to map — the dependency surface is empty.",
                evidence="0 dependencies",
            )
        ]
    share = budget / len(findings)
    rows = []
    for lib in findings:
        status_note = {
            "compatible": "fully compatible",
            "needs-conversion": "convertible with a mapped RN equivalent",
            "partial": "partially mappable",
            "unsupported": "unsupported — grants no coverage",
            "unknown": "unknown to Rejox — reviewed conservatively",
        }[lib.status]
        rows.append(
            ScoreContribution(
                label=f"{lib.name} ({status_note})",
                delta=_round(share * lib.compatibility / 100.0),
                reason=lib.notes or status_note,
                evidence=f"dependency: {lib.name}"
                + (f"@{lib.version}" if lib.version else ""),
            )
        )
    return rows


def _styling_rows(findings: list[ComponentFinding]) -> list[ScoreContribution]:
    budget = AREA_BUDGETS["styling"]
    rows = [
        ScoreContribution(
            label="Styling surface",
            delta=_round(budget),
            reason="Tailwind's mechanical majority maps 1:1 under NativeWind.",
            evidence=f"{len(findings)} component(s) styled",
        )
    ]
    deductions: list[tuple[str, float, int]] = []
    total = 0.0
    for code, penalty in _STYLING_PENALTY.items():
        count = sum(1 for f in findings if any(i.code == code for i in f.issues))
        if count == 0:
            continue
        amount = budget * penalty * count / 100.0
        deductions.append((code, amount, count))
        total += amount
    # The old sub-score clamps at 0; keep the arithmetic exact by scaling.
    scale = min(1.0, budget / total) if total > budget else 1.0
    for code, amount, count in sorted(deductions):
        rows.append(
            ScoreContribution(
                label=_CODE_LABELS.get(code, code),
                delta=_round(-amount * scale),
                reason=f"{code} has no clean NativeWind/RN mapping; needs re-expression.",
                evidence=f"{count} component(s) affected",
            )
        )
    return rows


def _routing_rows(routing: RoutingReport) -> list[ScoreContribution]:
    budget = AREA_BUDGETS["routing"]
    if routing.library is None:
        return [
            ScoreContribution(
                label="No web router",
                delta=_round(budget),
                reason="Nothing to convert — no client-side router detected.",
                evidence="no routing dependency",
            )
        ]
    rows = [
        ScoreContribution(
            label=f"Routing ({routing.library})",
            delta=_round(budget),
            reason=(
                "The route table is graph-resolved; links and params convert by "
                "rule to React Navigation."
            ),
            evidence=f"{len(routing.routes)} route(s) mapped to screens",
        ),
        ScoreContribution(
            label="Router conversion overhead",
            delta=-2.0,
            reason="Navigator structure still needs wiring and review.",
            evidence=f"dependency: {routing.library}",
        ),
    ]
    unparsed = sum(1 for w in routing.warnings if w.code == codes.OBJECT_ROUTER_UNPARSED)
    for _ in range(unparsed):
        rows.append(
            ScoreContribution(
                label="Object-config router unparsed",
                delta=-2.0,
                reason="createBrowserRouter(...) routes were not extracted; the table may be incomplete.",
                evidence="parser warning: object-config router",
            )
        )
    return rows


def _api_rows(kg: KnowledgeGraph) -> list[ScoreContribution]:
    budget = AREA_BUDGETS["api"]
    endpoints = kg.apiLayer.endpoints
    if not kg.apiLayer.clients and not endpoints:
        return [
            ScoreContribution(
                label="No API layer",
                delta=_round(budget),
                reason="Nothing to carry over.",
                evidence="0 endpoints",
            )
        ]
    rows = [
        ScoreContribution(
            label="API layer (axios/fetch)",
            delta=_round(budget),
            reason="HTTP clients run unchanged in React Native.",
            evidence=f"{len(endpoints)} endpoint(s), {len(kg.apiLayer.clients)} client(s)",
        )
    ]
    unresolved = [e for e in endpoints if e.url is None]
    for endpoint in unresolved:
        rows.append(
            ScoreContribution(
                label="Unresolved endpoint URL",
                delta=-0.5,
                reason="URL is built at runtime; needs manual verification.",
                evidence=f"file: {endpoint.file}",
            )
        )
    return rows


def build_contributions(
    component_findings: list[ComponentFinding],
    library_findings: list[LibraryFinding],
    routing: RoutingReport,
    kg: KnowledgeGraph,
) -> tuple[list[ScoreContribution], float]:
    """The explainable Coverage breakdown; deltas sum exactly to Coverage."""
    rows = (
        _components_rows(component_findings)
        + _library_rows(library_findings)
        + _styling_rows(component_findings)
        + _routing_rows(routing)
        + _api_rows(kg)
    )
    coverage = round(sum(r.delta for r in rows), 2)
    coverage = max(0.0, min(100.0, coverage))
    return rows, coverage
