"""Acceptance tests for the Analyzer stage.

These run against committed KG fixtures (no re-parse = fast) through the pure
``analyze_graph`` entry point. Every assertion checks a real, KG-derived number.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.analysis import AnalysisReport
from app.models.knowledge_graph import KnowledgeGraph
from app.pipeline.analyzer import analyze_graph

FIXTURES = Path(__file__).resolve().parent / "fixtures"
REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_APP = REPO_ROOT / "test-projects" / "sample-app"


def _load(name: str) -> KnowledgeGraph:
    return KnowledgeGraph.model_validate(json.loads((FIXTURES / name).read_text()))


@pytest.fixture(scope="module")
def report() -> AnalysisReport:
    return analyze_graph(_load("sample-app.kg.json"))


@pytest.fixture(scope="module")
def redux_report() -> AnalysisReport:
    return analyze_graph(_load("redux-table.kg.json"))


def _library(report: AnalysisReport, name_substr: str):
    matches = [l for l in report.libraries if name_substr in l.name]
    assert matches, f"no library finding matching {name_substr!r}"
    return matches[0]


def _component(report: AnalysisReport, name: str):
    return next(c for c in report.components if c.name == name)


# --- Library rules ----------------------------------------------------------


def test_library_verdicts(report: AnalysisReport) -> None:
    assert _library(report, "axios").status == "compatible"
    assert _library(report, "react-router-dom").status == "needs-conversion"
    assert _library(report, "zustand").status == "compatible"

    tailwind = _library(report, "tailwind")
    assert tailwind.status == "partial"
    assert any("NativeWind" in e.name for e in tailwind.rnEquivalents)


def test_react_router_has_rn_equivalents(report: AnalysisReport) -> None:
    rr = _library(report, "react-router-dom")
    names = {e.name for e in rr.rnEquivalents}
    assert "React Navigation" in names


def test_tailwind_and_vite_are_derived_not_dependencies(report: AnalysisReport) -> None:
    # Neither is a declared dependency, but both must appear as findings.
    kg = _load("sample-app.kg.json")
    assert "tailwindcss" not in kg.project.dependencies
    assert "vite" not in kg.project.dependencies
    assert _library(report, "tailwind").name == "tailwindcss"
    assert _library(report, "vite").category == "build"


# --- Component rules --------------------------------------------------------


def test_product_grid_flags_css_grid(report: AnalysisReport) -> None:
    grid = _component(report, "ProductGrid")
    codes = {i.code for i in grid.issues}
    assert "CSS_GRID" in codes
    assert "RESPONSIVE_BREAKPOINT" in codes


def test_button_flags_hover_state(report: AnalysisReport) -> None:
    button = _component(report, "Button")
    assert any(i.code == "HOVER_STATE" for i in button.issues)


def test_product_card_flags_css_module(report: AnalysisReport) -> None:
    pc = _component(report, "ProductCard")
    css_module = [i for i in pc.issues if i.code == "CSS_MODULE"]
    assert css_module
    assert css_module[0].severity == "warning"
    assert "ProductCard.module.css" in css_module[0].evidence.detail


def test_every_component_has_difficulty_and_score(report: AnalysisReport) -> None:
    assert len(report.components) == 21
    valid = {"trivial", "easy", "medium", "hard", "blocked"}
    for c in report.components:
        assert c.difficulty in valid
        assert 0 <= c.score <= 100


def test_no_component_is_blocked_in_sample_app(report: AnalysisReport) -> None:
    assert [c.name for c in report.components if c.difficulty == "blocked"] == []


def test_sample_app_has_no_blockers(report: AnalysisReport) -> None:
    assert report.blockers == []


# --- Conversion-fact rules (Deterministic Transformer facts) ----------------


def _codes(report: AnalysisReport, name: str) -> set[str]:
    return {i.code for i in _component(report, name).issues}


def test_implicit_flex_row_flagged(report: AnalysisReport) -> None:
    # Spinner's outer div is `flex` with no explicit direction (web row, RN column).
    assert "IMPLICIT_FLEX_ROW" in _codes(report, "Spinner")


def test_unsized_image_flagged(report: AnalysisReport) -> None:
    # ProductCard's <img> uses a CSS-Module class → no statically-known size.
    assert "UNSIZED_IMAGE" in _codes(report, "ProductCard")
    # CartItem's <img> has explicit h-14/w-14 → not flagged.
    assert "UNSIZED_IMAGE" not in _codes(report, "CartItem")


def test_missing_text_wrap_flagged(report: AnalysisReport) -> None:
    # Navbar has bare text inside <NavLink> (not a text-ish element).
    assert "MISSING_TEXT_WRAP" in _codes(report, "Navbar")
    # ...and Rating's glyph sits inside <span> (already text-ish) → not flagged.
    assert "MISSING_TEXT_WRAP" not in _codes(report, "Rating")


# --- Routing ----------------------------------------------------------------


def test_routing_maps_to_navigation_stack(report: AnalysisReport) -> None:
    assert report.routing.library == "react-router-dom"
    assert report.routing.hasParams is True
    detail = next(r for r in report.routing.routes if r.params == ["id"])
    assert detail.componentName == "ProductDetailPage"


# --- Coverage / Confidence / Risk ---------------------------------------------


def test_coverage_confidence_risk_all_present(report: AnalysisReport) -> None:
    assert 0 <= report.coverage <= 100
    assert 0 <= report.confidence <= 100
    assert report.risk in ("low", "medium", "high")


def test_coverage_and_confidence_are_independent_axes(report: AnalysisReport) -> None:
    # THE POINT of the score overhaul: sample-app is mostly deterministic, so
    # Confidence (how sure we are about what WAS migrated) is high, while
    # Coverage (how much of the project migrates) is dragged down by residue
    # (hover/grid/CSS Modules). A single conflated score would hide exactly
    # this distinction — assert they differ so it can never silently return.
    assert report.confidence > 90
    assert report.coverage < 90
    assert report.coverage != report.confidence


def test_contributions_sum_exactly_to_coverage(report: AnalysisReport) -> None:
    # The breakdown is not decorative — the arithmetic must actually work.
    assert sum(c.delta for c in report.contributions) == pytest.approx(
        report.coverage, abs=0.01
    )


def test_contributions_are_explainable(report: AnalysisReport) -> None:
    labels = {c.label for c in report.contributions}
    assert "Functional components" in labels
    assert any(l.startswith("axios") for l in labels)
    assert "Hover styling" in labels  # a real negative with evidence
    hover = next(c for c in report.contributions if c.label == "Hover styling" and c.delta < -1)
    assert "component(s)" in hover.evidence
    for c in report.contributions:
        assert c.label and c.reason and c.evidence


def test_confidence_is_computed_from_provenance(report: AnalysisReport) -> None:
    # Everything the transformer resolves deterministically scores 100/80;
    # residue is excluded. With no AI in play the figure must sit between
    # the warning grade and the clean grade.
    assert 80 <= report.confidence <= 100


# --- Domains --------------------------------------------------------------------


def test_sample_app_detects_no_high_risk_domain(report: AnalysisReport) -> None:
    # A storefront benchmark: no auth, no payments, no uploads.
    assert [d for d in report.domains if d.risk == "high"] == []
    assert report.risk in ("low", "medium")


def test_auth_app_detects_authentication_domain() -> None:
    auth_report = analyze_graph(_load("auth-app.kg.json"))
    domains = {d.domain: d for d in auth_report.domains}
    assert "authentication" in domains
    auth = domains["authentication"]
    assert auth.risk == "high"
    # Triggered by the API endpoint (strong signal), corroborated by the
    # login component and the token in localStorage.
    details = " | ".join(e.detail for e in auth.evidence)
    assert "/auth/login" in details
    assert "LoginForm" in details
    assert "localStorage" in details
    assert auth_report.risk == "high"


def test_domains_require_strong_signals() -> None:
    # redux-table has a Dashboard component using localStorage — but no auth
    # dependency and no auth endpoint/route. Corroborating signals alone must
    # never trigger a domain.
    redux = analyze_graph(_load("redux-table.kg.json"))
    assert redux.domains == []
    assert redux.risk == "low"


def test_summary_counts(report: AnalysisReport) -> None:
    s = report.summary
    assert s.componentCount == 21
    assert s.pageCount == 4
    assert s.routeCount == 4
    assert s.apiEndpointCount == 2
    assert s.storeCount == 1


# --- Synthetic redux + table ------------------------------------------------


def test_redux_is_a_blocker(redux_report: AnalysisReport) -> None:
    redux_blockers = [
        b for b in redux_report.blockers
        if b.code == "UNSUPPORTED_LIBRARY" and "redux" in b.evidence.detail
    ]
    assert redux_blockers
    assert _library(redux_report, "redux").status == "unsupported"


def test_table_component_is_blocked(redux_report: AnalysisReport) -> None:
    dashboard = _component(redux_report, "Dashboard")
    assert dashboard.difficulty == "blocked"
    assert any(
        i.code == "WEB_ONLY_ELEMENT" and "<table>" in i.evidence.detail
        for i in dashboard.issues
    )


def test_web_api_usage_flagged(redux_report: AnalysisReport) -> None:
    dashboard = _component(redux_report, "Dashboard")
    assert any(i.code == "WEB_API_USAGE" for i in dashboard.issues)


def test_coverage_drops_for_unsupported_project(
    report: AnalysisReport, redux_report: AnalysisReport
) -> None:
    assert redux_report.coverage < report.coverage
    assert redux_report.coverage < 60
    # ...and its contributions still sum exactly to its coverage.
    assert sum(c.delta for c in redux_report.contributions) == pytest.approx(
        redux_report.coverage, abs=0.01
    )


# --- API endpoint -----------------------------------------------------------


def test_analyze_endpoint_returns_report() -> None:
    client = TestClient(app)
    resp = client.post("/api/analyze", json={"path": str(SAMPLE_APP)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["projectName"] == "sample-app"
    assert 60 <= body["coverage"] <= 95
    assert body["confidence"] > body["coverage"]  # deterministic-heavy project
    assert body["risk"] == "low"
    assert body["summary"]["componentCount"] == 21


def test_analyze_endpoint_rejects_bad_path() -> None:
    client = TestClient(app)
    resp = client.post("/api/analyze", json={"path": "/no/such/project/xyz"})
    assert resp.status_code == 400
