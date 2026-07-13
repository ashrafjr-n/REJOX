"""Acceptance tests for the Parser stage.

These run the real Node parser-worker against the committed sample-app benchmark
and assert concrete, expected numbers — this is the gate for the stage.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.knowledge_graph import KnowledgeGraph
from app.pipeline.intelligence import IntelligenceError, build_knowledge_graph

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_APP = REPO_ROOT / "test-projects" / "sample-app"
BROKEN_PROJECT = Path(__file__).resolve().parent / "fixtures" / "broken-project"

EXPECTED_COMPONENTS = {
    "App", "Button", "CartBadge", "CartItem", "CartSummary", "ErrorMessage",
    "FeatureCard", "Footer", "Hero", "HomePage", "Layout", "Navbar",
    "ProductCard", "ProductDetailPage", "ProductGrid", "ProductsPage",
    "QuantityStepper", "Rating", "SettingToggle", "SettingsPage", "Spinner",
}


@pytest.fixture(scope="module")
def kg() -> KnowledgeGraph:
    """Parse the sample-app once for the whole module."""
    return build_knowledge_graph(SAMPLE_APP)


# --- Project ----------------------------------------------------------------


def test_project_metadata(kg: KnowledgeGraph) -> None:
    assert kg.project.name == "sample-app"
    assert kg.project.framework == "react"
    assert kg.project.language == "ts"
    assert kg.project.bundler == "vite"
    for dep in ("react", "react-router-dom", "axios", "zustand"):
        assert dep in kg.project.dependencies


def test_clean_parse_has_no_warnings(kg: KnowledgeGraph) -> None:
    assert kg.warnings == []


# --- Components -------------------------------------------------------------


def test_component_count_and_names(kg: KnowledgeGraph) -> None:
    names = {c.name for c in kg.components}
    assert len(kg.components) == 21
    assert names == EXPECTED_COMPONENTS


def test_product_card_props_and_jsx(kg: KnowledgeGraph) -> None:
    pc = next(c for c in kg.components if c.name == "ProductCard")
    prop_names = {p.name for p in pc.props}
    assert prop_names == {"product"}
    assert pc.jsxElements.get("img") == 1
    assert "onClick" in pc.eventHandlers
    assert "useCartStore" in pc.hooksUsed


def test_button_props_extends_records_dom_interface(kg: KnowledgeGraph) -> None:
    # Inherited props are not expanded (known limitation), but the heritage is
    # a graph fact — later stages resolve DOM props (onClick, ...) from it.
    button = next(c for c in kg.components if c.name == "Button")
    assert button.propsExtends == ["ButtonHTMLAttributes"]
    # A component with a plain local interface inherits nothing.
    stepper = next(c for c in kg.components if c.name == "QuantityStepper")
    assert stepper.propsExtends == []


# --- Hooks ------------------------------------------------------------------


def test_use_fetch_is_custom_hook_used_by_two_pages(kg: KnowledgeGraph) -> None:
    custom = [h for h in kg.hooks if h.isCustom]
    names = {h.name for h in custom}
    assert names == {"useFetch"}

    use_fetch = next(h for h in kg.hooks if h.name == "useFetch")
    assert use_fetch.isCustom is True
    assert set(use_fetch.usedBy) == {"ProductsPage", "ProductDetailPage"}


# --- Routes -----------------------------------------------------------------


def test_four_routes_with_param_on_product_detail(kg: KnowledgeGraph) -> None:
    assert len(kg.routes) == 4
    paths = {r.path for r in kg.routes}
    assert paths == {"/", "products", "products/:id", "settings"}

    detail = next(r for r in kg.routes if r.path == "products/:id")
    assert detail.hasParams is True
    assert detail.params == ["id"]
    assert detail.componentName == "ProductDetailPage"

    for r in kg.routes:
        if r.path != "products/:id":
            assert r.hasParams is False


# --- State management -------------------------------------------------------


def test_zustand_store_detected_with_state_keys(kg: KnowledgeGraph) -> None:
    assert kg.stateManagement.library == "zustand"
    assert len(kg.stateManagement.stores) == 1

    store = kg.stateManagement.stores[0]
    assert store.name == "useCartStore"
    assert store.file.endswith("cartStore.ts")
    assert {"lines", "add", "remove", "clear", "total"} <= set(store.stateKeys)
    assert "ProductCard" in store.usedBy


# --- API layer --------------------------------------------------------------


def test_axios_client_and_endpoints(kg: KnowledgeGraph) -> None:
    assert len(kg.apiLayer.clients) == 1
    client = kg.apiLayer.clients[0]
    assert client.library == "axios"
    assert client.baseURL is not None
    assert "jsonplaceholder" in client.baseURL

    urls = {e.url for e in kg.apiLayer.endpoints}
    assert "/photos" in urls
    assert any(u and u.startswith("/photos/") for u in urls)
    assert all(e.method == "GET" for e in kg.apiLayer.endpoints)


# --- Styling ----------------------------------------------------------------


def test_css_module_detected_on_product_card(kg: KnowledgeGraph) -> None:
    pc = next(c for c in kg.components if c.name == "ProductCard")
    assert "css-module" in pc.stylingApproach
    assert any("ProductCard.module.css" in p for p in pc.cssModuleImports)


def test_tailwind_classes_present_on_styled_components(kg: KnowledgeGraph) -> None:
    for name in ("ProductCard", "Navbar", "Hero", "Button"):
        comp = next(c for c in kg.components if c.name == name)
        assert "tailwind" in comp.stylingApproach
        assert len(comp.tailwindClasses) > 0

    # Invariant: anything flagged tailwind must carry concrete class tokens.
    for comp in kg.components:
        if "tailwind" in comp.stylingApproach:
            assert comp.tailwindClasses, f"{comp.name} tailwind but no classes"


# --- Edges ------------------------------------------------------------------


def test_edges_cover_all_kinds(kg: KnowledgeGraph) -> None:
    kinds = {e.kind for e in kg.edges}
    assert {"imports", "renders", "uses-hook", "uses-store", "calls-api"} <= kinds


# --- Graceful degradation ---------------------------------------------------


def test_broken_file_is_warned_not_crashed() -> None:
    graph = build_knowledge_graph(BROKEN_PROJECT)
    # A syntax error becomes a warning, not an exception.
    assert graph.warnings, "expected at least one warning for the broken file"
    assert any("Syntax error" in w for w in graph.warnings)
    # Valid sibling component is still extracted.
    assert any(c.name == "Good" for c in graph.components)


# --- API endpoint -----------------------------------------------------------


def test_parse_endpoint_returns_knowledge_graph() -> None:
    client = TestClient(app)
    resp = client.post("/api/parse", json={"path": str(SAMPLE_APP)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["project"]["name"] == "sample-app"
    assert len(body["components"]) == 21


def test_parse_endpoint_rejects_bad_path() -> None:
    client = TestClient(app)
    resp = client.post("/api/parse", json={"path": "/no/such/project/xyz"})
    assert resp.status_code == 400


def test_build_knowledge_graph_raises_on_missing_path() -> None:
    with pytest.raises(IntelligenceError):
        build_knowledge_graph(Path("/definitely/not/here"))
