"""Scoring rules.

Turns findings into the weighted migration score. Every sub-score is a pure
function of findings/KG facts. The weights are fixed and documented here and in
docs/ARCHITECTURE.md.

    migrationScore = 0.40*components + 0.25*libraries + 0.20*styling
                   + 0.10*routing   + 0.05*api

Component score (0-100, higher = easier):
    penalty = Σ severity_penalty(issue)      info=2, warning=10, blocker=40
    with a blocker → difficulty "blocked", score capped at 20
    else score = 100 - penalty, bucketed:
        ≥90 trivial · ≥75 easy · ≥55 medium · <55 hard
"""

from __future__ import annotations

from app.models.analysis import (
    ComponentFinding,
    Difficulty,
    LibraryFinding,
    RoutingReport,
    ScoreBreakdown,
    SubScore,
)
from app.models.knowledge_graph import KnowledgeGraph

from . import codes

# --- Component scoring ------------------------------------------------------

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


# --- Sub-scores -------------------------------------------------------------

# Per-component styling-issue penalties (points off the styling sub-score).
_STYLING_PENALTY = {
    codes.CSS_GRID: 3,
    codes.HOVER_STATE: 2,
    codes.RESPONSIVE_BREAKPOINT: 1,
    codes.GRADIENT: 2,
    codes.GROUP_SELECTOR: 2,
    codes.CSS_MODULE: 4,
    codes.DYNAMIC_CLASSNAME: 5,
}


def components_subscore(findings: list[ComponentFinding]) -> float:
    if not findings:
        return 100.0
    return sum(f.score for f in findings) / len(findings)


def libraries_subscore(findings: list[LibraryFinding]) -> float:
    if not findings:
        return 100.0
    return sum(f.compatibility for f in findings) / len(findings)


def styling_subscore(findings: list[ComponentFinding]) -> float:
    score = 100.0
    for code, penalty in _STYLING_PENALTY.items():
        n = sum(1 for f in findings if any(i.code == code for i in f.issues))
        score -= penalty * n
    return max(0.0, min(100.0, score))


def routing_subscore(routing: RoutingReport) -> float:
    if routing.library is None:
        return 100.0
    score = 80.0
    unparsed = sum(1 for w in routing.warnings if w.code == codes.OBJECT_ROUTER_UNPARSED)
    score -= 20.0 * unparsed
    return max(0.0, min(100.0, score))


def api_subscore(kg: KnowledgeGraph) -> float:
    clients = kg.apiLayer.clients
    endpoints = kg.apiLayer.endpoints
    if not clients and not endpoints:
        return 100.0
    score = 100.0
    # Endpoints whose URL couldn't be read statically need manual attention.
    score -= 10.0 * sum(1 for e in endpoints if e.url is None)
    return max(0.0, min(100.0, score))


# --- Breakdown --------------------------------------------------------------

WEIGHTS = {
    "components": 0.40,
    "libraries": 0.25,
    "styling": 0.20,
    "routing": 0.10,
    "api": 0.05,
}


def build_score_breakdown(
    component_findings: list[ComponentFinding],
    library_findings: list[LibraryFinding],
    routing: RoutingReport,
    kg: KnowledgeGraph,
) -> ScoreBreakdown:
    return ScoreBreakdown(
        components=SubScore(score=round(components_subscore(component_findings), 2), weight=WEIGHTS["components"]),
        libraries=SubScore(score=round(libraries_subscore(library_findings), 2), weight=WEIGHTS["libraries"]),
        styling=SubScore(score=round(styling_subscore(component_findings), 2), weight=WEIGHTS["styling"]),
        routing=SubScore(score=round(routing_subscore(routing), 2), weight=WEIGHTS["routing"]),
        api=SubScore(score=round(api_subscore(kg), 2), weight=WEIGHTS["api"]),
    )
