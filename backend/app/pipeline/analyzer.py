"""Analyzer stage.

Pure, deterministic analysis over the Knowledge Graph. ``analyze_graph`` is the
entry point used by both the API and the tests — it composes the small rule
functions in ``app.pipeline.rules`` into an :class:`AnalysisReport`. No LLM, no
source re-parsing; every finding is traceable to a KG fact.

Failures are typed: any rule that blows up is re-raised as an
:class:`AnalyzerError` naming the rule and the graph it was walking, so the
caller (API / CLI) reports *what* failed rather than a bare traceback — the same
contract ``IngestError`` / ``IntelligenceError`` / ``TransformerError`` provide
for the stages around it.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from app.models.analysis import AnalysisReport, Issue, Summary
from app.models.knowledge_graph import KnowledgeGraph

from .rules import scoring
from .rules.components import analyze_components
from .rules.domains import detect_domains, overall_risk
from .rules.libraries import analyze_libraries, library_issues
from .rules.parsing import parse_issues
from .rules.routing import analyze_routing
from .rules.styling import analyze_styling


class AnalyzerError(RuntimeError):
    """Raised when the Analyzer cannot turn a Knowledge Graph into a report.

    The Analyzer is deterministic and total over a valid KG, so this means a
    rule hit graph content it could not handle — a defect, not user input. The
    message carries the failing rule plus the KG's shape so the failure is
    diagnosable from the message alone.
    """


def _kg_context(kg: KnowledgeGraph) -> str:
    """The KG facts worth embedding in a failure message."""
    return (
        f"project '{kg.project.name}' ({len(kg.files)} files, "
        f"{len(kg.components)} components, {len(kg.routes)} routes, "
        f"{len(kg.project.dependencies)} dependencies)"
    )


@contextmanager
def _rule(label: str, kg: KnowledgeGraph) -> Iterator[None]:
    """Run one analysis step, tagging any failure with the step + KG context."""
    try:
        yield
    except AnalyzerError:
        raise  # already tagged — never re-wrap
    except Exception as exc:
        raise AnalyzerError(
            f"Analyzer failed in {label} for {_kg_context(kg)}: "
            f"{type(exc).__name__}: {exc}"
        ) from exc


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
    """Analyze a Knowledge Graph into a Migration Report.

    Raises:
        AnalyzerError: if any rule fails on this graph.
    """
    with _rule("library rules", kg):
        libraries = analyze_libraries(kg)
    with _rule("component rules", kg):
        components = analyze_components(kg)
    with _rule("routing rules", kg):
        routing = analyze_routing(kg)
    with _rule("styling rules", kg):
        styling = analyze_styling(kg)
    with _rule("domain rules", kg):
        domains = detect_domains(kg)

    # Aggregate cross-cutting issues.
    with _rule("issue aggregation", kg):
        issues: list[Issue] = []
        issues += library_issues(libraries)
        issues += routing.warnings
        # Per-file parse/extraction warnings from the parser-worker: a file the
        # worker could not fully read is a hole in every rule above, so it is
        # reported here rather than left silent on the graph.
        issues += parse_issues(kg)
        for finding in components:
            issues += finding.issues

        blockers = [i for i in issues if i.severity == "blocker"]
        warnings = [i for i in issues if i.severity == "warning"]

    # The three independent axes: Coverage (what migrates), Confidence
    # (how sure we are about what migrates — provenance-based), Risk
    # (worst detected functional domain).
    with _rule("scoring", kg):
        contributions, coverage = scoring.build_contributions(
            components, libraries, routing, kg
        )
        confidence = scoring.compute_confidence(components)

    with _rule("report assembly", kg):
        return AnalysisReport(
            projectName=kg.project.name,
            summary=_summary(kg),
            libraries=libraries,
            components=components,
            routing=routing,
            styling=styling,
            domains=domains,
            blockers=blockers,
            warnings=warnings,
            coverage=coverage,
            confidence=confidence,
            risk=overall_risk(domains),
            contributions=contributions,
        )
