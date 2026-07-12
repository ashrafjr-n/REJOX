"""Analyzer stage.

Pure, deterministic analysis over the Knowledge Graph. ``analyze_graph`` is the
entry point used by both the API and the tests — it composes the small rule
functions in ``app.pipeline.rules`` into an :class:`AnalysisReport`. No LLM, no
source re-parsing; every finding is traceable to a KG fact.
"""

from __future__ import annotations

from app.models.analysis import AnalysisReport, Issue, Summary
from app.models.knowledge_graph import KnowledgeGraph

from .rules import scoring
from .rules.components import analyze_components
from .rules.libraries import analyze_libraries, library_issues
from .rules.routing import analyze_routing
from .rules.styling import analyze_styling


def _summary(kg: KnowledgeGraph) -> Summary:
    page_names = {r.componentName for r in kg.routes if r.componentName}
    return Summary(
        componentCount=len(kg.components),
        pageCount=len(page_names),
        routeCount=len(kg.routes),
        apiEndpointCount=len(kg.apiLayer.endpoints),
        storeCount=len(kg.stateManagement.stores),
    )


def analyze_graph(kg: KnowledgeGraph) -> AnalysisReport:
    """Analyze a Knowledge Graph into a Migration Report."""
    libraries = analyze_libraries(kg)
    components = analyze_components(kg)
    routing = analyze_routing(kg)
    styling = analyze_styling(kg)

    # Aggregate cross-cutting issues.
    issues: list[Issue] = []
    issues += library_issues(libraries)
    issues += routing.warnings
    for finding in components:
        issues += finding.issues

    blockers = [i for i in issues if i.severity == "blocker"]
    warnings = [i for i in issues if i.severity == "warning"]

    breakdown = scoring.build_score_breakdown(components, libraries, routing, kg)
    migration_score = round(breakdown.weighted_total(), 1)

    return AnalysisReport(
        projectName=kg.project.name,
        summary=_summary(kg),
        libraries=libraries,
        components=components,
        routing=routing,
        styling=styling,
        blockers=blockers,
        warnings=warnings,
        migrationScore=migration_score,
        scoreBreakdown=breakdown,
    )
