"""Acceptance tests for the Planner stage.

Runs against committed KG fixtures (no re-parse = fast) through the pure
``plan_migration`` entry point. Assertions check real, findings-derived
structure — the questions generated and the ordered step DAG.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.knowledge_graph import KnowledgeGraph
from app.models.plan import MigrationPlan
from app.pipeline.analyzer import analyze_graph
from app.pipeline.planner import plan_migration

FIXTURES = Path(__file__).resolve().parent / "fixtures"
REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_APP = REPO_ROOT / "test-projects" / "sample-app"


def _load(name: str) -> KnowledgeGraph:
    return KnowledgeGraph.model_validate(json.loads((FIXTURES / name).read_text()))


@pytest.fixture(scope="module")
def sample_kg() -> KnowledgeGraph:
    return _load("sample-app.kg.json")


@pytest.fixture(scope="module")
def plan(sample_kg: KnowledgeGraph) -> MigrationPlan:
    return plan_migration(analyze_graph(sample_kg), sample_kg)


@pytest.fixture(scope="module")
def redux_plan() -> MigrationPlan:
    kg = _load("redux-table.kg.json")
    return plan_migration(analyze_graph(kg), kg)


def _step(plan: MigrationPlan, step_id: str):
    return next(s for s in plan.steps if s.id == step_id)


def _wave_index_of(plan: MigrationPlan, component_name: str) -> int:
    """Return the component-wave order for the component with this name."""
    waves = [s for s in plan.steps if s.kind == "components"]
    for i, step in enumerate(waves):
        if any(t.endswith(f"#{component_name}") for t in step.targets):
            return i
    raise AssertionError(f"{component_name} not found in any component wave")


# --- Questions --------------------------------------------------------------


def test_sample_app_generates_exactly_expected_questions(
    plan: MigrationPlan, sample_kg: KnowledgeGraph
) -> None:
    ids = {q.id for q in plan.questions}
    # Ground the storage/icons expectations in the actual fixture content.
    assert not any(c.webApis for c in sample_kg.components), "fixture unexpectedly has webApis"
    expected = {"project-type", "styling-engine", "navigation-library"}
    assert ids == expected  # no storage (no localStorage), no icons (no icon lib)


def test_every_question_has_exactly_one_recommended_option(plan: MigrationPlan) -> None:
    for q in plan.questions:
        recommended = [o for o in q.options if o.isRecommended]
        assert len(recommended) == 1, f"{q.id} must have exactly one recommendation"


def test_question_context_cites_real_numbers(plan: MigrationPlan) -> None:
    styling = next(q for q in plan.questions if q.id == "styling-engine")
    assert "138 Tailwind classes" in styling.context
    nav = next(q for q in plan.questions if q.id == "navigation-library")
    assert "4 routes" in nav.context


# --- Step ordering ----------------------------------------------------------


def test_setup_first_validation_last(plan: MigrationPlan) -> None:
    assert plan.steps[0].kind == "setup"
    assert plan.steps[0].order == 1
    assert plan.steps[-1].kind == "validation"
    assert plan.steps[-1].order == len(plan.steps)


def test_routing_before_navigation_wiring(plan: MigrationPlan) -> None:
    routing = _step(plan, "routing")
    navigation = _step(plan, "navigation")
    assert routing.order < navigation.order
    assert "routing" in navigation.dependsOn


def test_has_at_least_one_components_step(plan: MigrationPlan) -> None:
    assert any(s.kind == "components" for s in plan.steps)


def test_component_waves_respect_render_topology(plan: MigrationPlan) -> None:
    leaves = min(_wave_index_of(plan, n) for n in ("Button", "Rating", "Spinner"))
    product_card = _wave_index_of(plan, "ProductCard")
    products_page = _wave_index_of(plan, "ProductsPage")
    assert leaves < product_card, "leaf components must convert before ProductCard"
    assert product_card < products_page, "ProductCard must convert before ProductsPage"


def test_all_waves_cover_every_component(plan: MigrationPlan, sample_kg: KnowledgeGraph) -> None:
    covered = [t for s in plan.steps if s.kind == "components" for t in s.targets]
    assert len(covered) == len(sample_kg.components)
    assert len(set(covered)) == len(covered)  # no component in two waves


# --- DAG integrity ----------------------------------------------------------


def test_dependencies_reference_existing_steps(plan: MigrationPlan) -> None:
    ids = {s.id for s in plan.steps}
    for s in plan.steps:
        for dep in s.dependsOn:
            assert dep in ids, f"{s.id} depends on missing step {dep}"


def test_step_dag_has_no_cycles(plan: MigrationPlan) -> None:
    graph = {s.id: set(s.dependsOn) for s in plan.steps}
    # Kahn's algorithm: if we can remove every node, the graph is acyclic.
    resolved: set[str] = set()
    progress = True
    while progress and len(resolved) < len(graph):
        progress = False
        for node, deps in graph.items():
            if node not in resolved and deps <= resolved:
                resolved.add(node)
                progress = True
    assert len(resolved) == len(graph), "step graph contains a cycle"


def test_no_empty_target_steps(plan: MigrationPlan) -> None:
    empty = [s.id for s in plan.steps if not s.targets]
    assert empty == [], f"steps with no targets: {empty}"


def test_dependsOn_only_points_backwards(plan: MigrationPlan) -> None:
    order_of = {s.id: s.order for s in plan.steps}
    for s in plan.steps:
        for dep in s.dependsOn:
            assert order_of[dep] < s.order, f"{s.id} depends on later step {dep}"


# --- Manual review + unsupported --------------------------------------------


def test_manual_review_includes_css_module_and_medium(plan: MigrationPlan) -> None:
    ids = {m.componentId for m in plan.manualReviewCandidates}
    assert any(i.endswith("#ProductCard") for i in ids)          # CSS_MODULE
    assert any(i.endswith("#ProductDetailPage") for i in ids)    # difficulty medium


def test_sample_app_has_no_unsupported_items(plan: MigrationPlan) -> None:
    assert plan.unsupportedItems == []


# --- Synthetic redux --------------------------------------------------------


def test_redux_listed_in_unsupported_with_suggestion(redux_plan: MigrationPlan) -> None:
    redux = next((u for u in redux_plan.unsupportedItems if u.name == "redux"), None)
    assert redux is not None
    assert "zustand" in redux.suggestion.lower()


def test_redux_plan_still_generates_steps(redux_plan: MigrationPlan) -> None:
    assert redux_plan.steps[0].kind == "setup"
    assert redux_plan.steps[-1].kind == "validation"
    assert any(s.kind == "components" for s in redux_plan.steps)
    # No router in that fixture → no routing/navigation steps.
    kinds = {s.kind for s in redux_plan.steps}
    assert "routing" not in kinds and "navigation" not in kinds


def test_redux_plan_asks_storage_question(redux_plan: MigrationPlan) -> None:
    # The Dashboard component uses localStorage in that fixture.
    assert any(q.id == "storage" for q in redux_plan.questions)


# --- API endpoint -----------------------------------------------------------


def test_plan_endpoint_returns_report_and_plan() -> None:
    client = TestClient(app)
    resp = client.post("/api/plan", json={"path": str(SAMPLE_APP)})
    assert resp.status_code == 200
    body = resp.json()
    assert "report" in body and "plan" in body
    assert body["report"]["projectName"] == "sample-app"
    assert body["plan"]["steps"][0]["kind"] == "setup"
    assert {q["id"] for q in body["plan"]["questions"]} == {
        "project-type", "styling-engine", "navigation-library"
    }


def test_plan_endpoint_rejects_bad_path() -> None:
    client = TestClient(app)
    resp = client.post("/api/plan", json={"path": "/no/such/project/xyz"})
    assert resp.status_code == 400
