"""Acceptance tests for the Deterministic Transformer (codemod-worker).

Transforms real files from sample-app — with the graph-derived options a real
run would use (route table, component event map) — and asserts the mechanical
transforms and the residue contract. Every output is independently re-parsed
and asserted syntactically valid — this is non-negotiable.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from app.models.knowledge_graph import KnowledgeGraph
from app.models.transformation import TransformResult
from app.pipeline.analyzer import analyze_graph
from app.pipeline.scaffold import generate_scaffold
from app.pipeline.transformer import (
    build_transform_options,
    check_syntax,
    transform_component,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC = REPO_ROOT / "test-projects" / "sample-app" / "src"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
ANSWERS = {"stylingEngine": "nativewind", "navigationLibrary": "react-navigation"}


@pytest.fixture(scope="module")
def options() -> dict:
    """The options a real migration would pass: answers + graph-derived facts."""
    kg = KnowledgeGraph.model_validate(
        json.loads((FIXTURES / "sample-app.kg.json").read_text())
    )
    return build_transform_options(kg, analyze_graph(kg), ANSWERS)


def _codes(result: TransformResult) -> set[str]:
    return {u.code for u in result.unhandled}


def _snippets(result: TransformResult, code: str) -> str:
    return " ".join(u.snippet for u in result.unhandled if u.code == code)


# --- Graph-derived options ----------------------------------------------------


def test_options_carry_route_table_and_component_events(options: dict) -> None:
    routes = {r["path"]: r for r in options["routes"]}
    assert routes["/products/:id"]["screen"] == "ProductDetail"
    assert routes["/products/:id"]["params"] == ["id"]
    assert routes["/"]["screen"] == "Home"
    # Button's props extend ButtonHTMLAttributes (graph fact) → DOM onClick.
    assert options["componentEvents"]["Button"] == {"onClick": "onPress"}
    # A component with its own (value) => void API is never renamed.
    assert "SettingToggle" not in options["componentEvents"]


# --- Navigation: <Link to> is a rule, not a judgment call ----------------------


def test_productcard_link_navigates_with_typed_params(options: dict) -> None:
    r = transform_component(SRC / "components" / "ProductCard.tsx", options)
    # Template path → matched route → screen + param binding, both links.
    assert r.code.count("navigation.navigate('ProductDetail', { id: product.id })") == 2
    assert "useNavigation" in r.code and "@react-navigation/native" in r.code
    # Fully resolved: no NAV_LINK residue remains for this file.
    assert "NAV_LINK" not in _codes(r)
    assert "</Link>" not in r.code


def test_static_link_navigates_without_params(options: dict) -> None:
    r = transform_component(SRC / "pages" / "ProductDetailPage.tsx", options)
    assert "navigation.navigate('Products')" in r.code
    assert "NAV_LINK" not in _codes(r)


def test_useparams_becomes_typed_useroute(options: dict) -> None:
    r = transform_component(SRC / "pages" / "ProductDetailPage.tsx", options)
    assert "useParams" not in r.code
    assert "(useRoute().params ?? {}) as { id: string }" in r.code
    assert "useRoute" in r.code.split("react-native")[0]  # imported up top
    assert "NAV_HOOK" not in _codes(r)


def test_navbar_dynamic_link_and_active_state_are_deliberate_todos(options: dict) -> None:
    r = transform_component(SRC / "components" / "Navbar.tsx", options)
    # The static brand link resolves...
    assert "navigation.navigate('Home')" in r.code
    # ...but `to={link.to}` is a runtime value (which screen? unknowable
    # statically) and isActive styling is navigation state — both are
    # deliberate residue, never silently dropped.
    assert "NAV_LINK" in _codes(r)
    assert "NAV_ACTIVE" in _codes(r)
    assert "REJOX-TODO(NAV_LINK)" in r.code


def test_router_containers_are_flagged_not_silently_dropped(options: dict) -> None:
    r = transform_component(SRC / "App.tsx", options)
    assert "NAV_CONTAINER" in _codes(r)
    layout = transform_component(SRC / "components" / "Layout.tsx", options)
    assert "NAV_CONTAINER" in _codes(layout)  # <Outlet />


# --- Images: prop shape is a rule; sizing is flagged ---------------------------


def test_image_src_becomes_source_with_injected_size(options: dict) -> None:
    r = transform_component(SRC / "components" / "ProductCard.tsx", options)
    assert "source={{ uri: product.thumbnailUrl }}" in r.code
    assert "accessibilityLabel={product.title}" in r.code
    assert "src=" not in r.code
    # No provable size (CSS-Module class) → placeholder + explicit warning.
    assert "style={{ width: 100, height: 100 }}" in r.code
    assert any(w.code == "IMAGE_SIZE" for w in r.warnings)
    assert "IMAGE_PROPS" not in _codes(r)  # closed: this is a rule now


def test_sized_image_gets_no_placeholder(options: dict) -> None:
    r = transform_component(SRC / "components" / "CartItem.tsx", options)
    # h-14/w-14 prove the size → no injection, no warning.
    assert not any(w.code == "IMAGE_SIZE" for w in r.warnings)
    assert "source={{ uri:" in r.code


# --- Props types: HTML interface → RN interface --------------------------------


def test_button_props_extend_pressableprops(options: dict) -> None:
    r = transform_component(SRC / "components" / "Button.tsx", options)
    assert "extends PressableProps" in r.code
    # The DOM interface is gone from code (the TODO header may cite it).
    assert "extends ButtonHTMLAttributes" not in r.code
    assert "from 'react'" not in r.code  # the type-only react import is dropped
    assert "PressableProps" in r.code.split("\n")[0]  # imported from react-native
    assert "PROPS_HTML_TYPE" not in _codes(r)  # closed: declarative map
    # className built from `base`/`variants` is preserved verbatim.
    assert "${base} ${variants[variant]} ${className}" in r.code


def test_button_callers_use_onpress_via_graph(options: dict) -> None:
    # ProductCard renders <Button onClick={…}> — the graph proves Button's
    # onClick is DOM-derived, so the call site is renamed consistently.
    r = transform_component(SRC / "components" / "ProductCard.tsx", options)
    assert "<Button onPress=" in r.code
    assert "onClick" not in r.code


def test_custom_component_api_events_are_never_touched(options: dict) -> None:
    # SettingsPage passes onChange={setNotifications} to SettingToggle — a
    # component API, not a DOM event. It must survive unchanged.
    r = transform_component(SRC / "pages" / "SettingsPage.tsx", options)
    assert "onChange={setNotifications}" in r.code
    assert "onChange={setDarkMode}" in r.code


# --- Tailwind → NativeWind ------------------------------------------------------


def test_supported_only_component_has_zero_residue(options: dict) -> None:
    # Footer uses flex/borders/colors/typography + sm: breakpoints — all
    # NativeWind-supported → the styling layer produces NO residue at all.
    r = transform_component(SRC / "components" / "Footer.tsx", options)
    assert r.unhandled == []


def test_hover_classes_are_residue(options: dict) -> None:
    r = transform_component(SRC / "components" / "Button.tsx", options)
    assert "TW_UNSUPPORTED" in _codes(r)
    assert "hover:bg-indigo-500" in _snippets(r, "TW_UNSUPPORTED")


def test_grid_classes_are_residue(options: dict) -> None:
    r = transform_component(SRC / "components" / "ProductGrid.tsx", options)
    assert "TW_UNSUPPORTED" in _codes(r)
    assert "grid" in _snippets(r, "TW_UNSUPPORTED").split()


def test_implicit_flex_row_made_explicit(options: dict) -> None:
    # Web flex defaults to row, RN to column — the rule appends flex-row.
    r = transform_component(SRC / "components" / "QuantityStepper.tsx", options)
    assert 'className="flex items-center gap-2 flex-row"' in r.code


# --- Elements, events, text (the original mechanical core) ---------------------


def test_spinner_divs_become_views(options: dict) -> None:
    r = transform_component(SRC / "components" / "Spinner.tsx", options)
    assert "<div" not in r.code and "</div>" not in r.code
    assert "<View" in r.code
    # Spinner's only residue is its CSS animation (animate-spin) — honest:
    # re-expressing it (Animated/Moti) is a design decision.
    assert _codes(r) == {"TW_UNSUPPORTED"}
    assert "animate-spin" in _snippets(r, "TW_UNSUPPORTED")


def test_quantitystepper_onclick_and_text_wrap(options: dict) -> None:
    r = transform_component(SRC / "components" / "QuantityStepper.tsx", options)
    assert "onPress=" in r.code and "onClick=" not in r.code
    assert "<Pressable" in r.code
    # The bare "−"/"+" glyphs are wrapped in <Text>.
    assert "<Text>−</Text>" in r.code
    assert "<Text>+</Text>" in r.code


def test_settingtoggle_drops_the_dom_only_button_type(options: dict) -> None:
    """`type` is a <button> attribute; Pressable has no such prop.

    Carrying it through the rename is a TS2322 and nothing else — no behaviour
    of the app lives in `type="button"` — so it is dropped with a warning rather
    than left for the AI. `role`/`aria-checked` stay: React Native supports both.
    """
    r = transform_component(SRC / "components" / "SettingToggle.tsx", options)
    assert "<Pressable" in r.code
    assert "type=" not in r.code
    assert 'role="switch"' in r.code and "aria-checked=" in r.code
    assert "WEB_ONLY_ATTRIBUTE" in {w.code for w in r.warnings}


def test_productcard_css_module_is_residue(options: dict) -> None:
    r = transform_component(SRC / "components" / "ProductCard.tsx", options)
    assert "CSS_MODULE" in _codes(r)
    assert "./ProductCard.module.css" in r.code  # kept, never silently dropped


def test_rating_glyph_is_text_wrapped(options: dict) -> None:
    r = transform_component(SRC / "components" / "Rating.tsx", options)
    assert "<span" not in r.code and "★" in r.code
    before = r.code[: r.code.index("★")]
    assert before.rfind("<Text") > before.rfind("<View")


# --- The non-negotiable: every output is valid TS -------------------------------


@pytest.mark.parametrize("rel", sorted(p.name for p in (SRC / "components").glob("*.tsx")))
def test_every_component_output_is_valid_typescript(rel: str, options: dict) -> None:
    r = transform_component(SRC / "components" / rel, options)
    assert check_syntax(r.code) == 0, f"{rel} produced invalid TS"


@pytest.mark.parametrize("rel", sorted(p.name for p in (SRC / "pages").glob("*.tsx")))
def test_every_page_output_is_valid_typescript(rel: str, options: dict) -> None:
    r = transform_component(SRC / "pages" / rel, options)
    assert check_syntax(r.code) == 0, f"{rel} produced invalid TS"


def test_app_output_is_valid_typescript(options: dict) -> None:
    r = transform_component(SRC / "App.tsx", options)
    assert check_syntax(r.code) == 0


def test_missing_file_raises() -> None:
    from app.pipeline.transformer import TransformerError

    with pytest.raises(TransformerError):
        transform_component(SRC / "components" / "DoesNotExist.tsx", ANSWERS)


# --- Scaffold -------------------------------------------------------------------


def test_scaffold_nativewind_react_navigation_wiring() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "app"
        res = generate_scaffold(
            out,
            {
                "project-type": "expo",
                "styling-engine": "nativewind",
                "navigation-library": "react-navigation",
            },
            {"zustand": "^5.0.14", "axios": "^1.18.1"},
            app_name="Sample Store",
        )

        babel = (out / "babel.config.js").read_text()
        assert 'jsxImportSource: "nativewind"' in babel
        assert '"nativewind/babel"' in babel

        metro = (out / "metro.config.js").read_text()
        assert "withNativeWind" in metro
        assert './global.css' in metro

        pkg = json.loads((out / "package.json").read_text())
        deps = pkg["dependencies"]
        assert "nativewind" in deps
        assert "@react-navigation/native" in deps
        assert "react-native-screens" in deps
        assert "react-native-safe-area-context" in deps
        # Carried over from the source project.
        assert deps["zustand"] == "^5.0.14"
        assert deps["axios"] == "^1.18.1"
        assert "tailwindcss" in pkg["devDependencies"]

        # NativeWind support files exist.
        assert (out / "global.css").exists()
        assert (out / "tailwind.config.js").exists()
        # src/ tree mirrors the source layout.
        for sub in ("components", "screens", "store", "api", "hooks"):
            assert (out / "src" / sub).is_dir()
        assert set(res.files) >= {"babel.config.js", "metro.config.js", "package.json"}


def test_scaffold_stylesheet_has_no_nativewind() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "app"
        generate_scaffold(
            out,
            {"project-type": "expo", "styling-engine": "stylesheet", "navigation-library": "react-navigation"},
            {},
        )
        babel = (out / "babel.config.js").read_text()
        assert "nativewind" not in babel
        metro = (out / "metro.config.js").read_text()
        assert "withNativeWind" not in metro
        assert not (out / "global.css").exists()
