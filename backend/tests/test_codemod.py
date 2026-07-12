"""Acceptance tests for the deterministic codemod (Converter Part 1).

Converts real files from sample-app and asserts the mechanical transforms and
the unhandled/warning contract. Every converted output is independently
re-parsed and asserted syntactically valid — this is non-negotiable.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from app.models.conversion import ConversionResult
from app.pipeline.converter import check_syntax, convert_component
from app.pipeline.scaffold import generate_scaffold

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC = REPO_ROOT / "test-projects" / "sample-app" / "src"
OPTIONS = {"stylingEngine": "nativewind", "navigationLibrary": "react-navigation"}


def _convert(rel: str) -> ConversionResult:
    return convert_component(SRC / rel, OPTIONS)


def _codes(result: ConversionResult) -> set[str]:
    return {u.code for u in result.unhandled}


# --- Per-file transforms ----------------------------------------------------


def test_spinner_divs_become_views() -> None:
    r = _convert("components/Spinner.tsx")
    assert "<div" not in r.code and "</div>" not in r.code
    assert "<View" in r.code
    assert "from 'react-native'" in r.code and "View" in r.code.split("react-native")[0]
    # Spinner has no text at all → nothing to wrap, no unhandled work.
    assert r.unhandled == []


def test_button_becomes_pressable_and_preserves_classname() -> None:
    r = _convert("components/Button.tsx")
    assert "<Pressable" in r.code and "<button" not in r.code
    # className built from `base`/`variants` is preserved verbatim.
    assert "${base} ${variants[variant]} ${className}" in r.code
    # The web DOM prop type is flagged, not silently kept as valid.
    assert "PROPS_HTML_TYPE" in _codes(r)


def test_quantitystepper_onclick_and_text_wrap() -> None:
    # QuantityStepper has real host <button onClick>…text… — the canonical case.
    r = _convert("components/QuantityStepper.tsx")
    assert "onPress=" in r.code and "onClick=" not in r.code
    assert "<Pressable" in r.code
    # The bare "−"/"+" glyphs are wrapped in <Text>.
    assert "<Text>−</Text>" in r.code
    assert "<Text>+</Text>" in r.code


def test_productcard_image_link_and_css_module() -> None:
    r = _convert("components/ProductCard.tsx")
    # img → Image. (TODO comments may mention "<img>"; assert no real <img>
    # element start remains.)
    assert "<Image" in r.code
    for marker in ("<img ", "<img\n", "<img/"):
        assert marker not in r.code
    # Link → Pressable, with a navigation TODO in the output. (Comments may
    # mention "<Link>", but no <Link> JSX element remains — no closing tag.)
    assert "<Pressable" in r.code and "</Link>" not in r.code
    assert "REJOX-TODO(NAV_LINK)" in r.code
    # The CSS Module import produces an unhandled entry (kept verbatim).
    assert "CSS_MODULE" in _codes(r)
    assert "./ProductCard.module.css" in r.code


def test_rating_glyph_is_text_wrapped() -> None:
    # The Array.from(...).map renders <span>★</span>; span→Text keeps the glyph
    # inside a <Text>, never bare in a <View>.
    r = _convert("components/Rating.tsx")
    assert "<span" not in r.code and "★" in r.code
    before = r.code[: r.code.index("★")]
    # The nearest enclosing opening tag before the glyph is a <Text>, not <View>.
    assert before.rfind("<Text") > before.rfind("<View")


def test_navbar_navlink_is_unhandled() -> None:
    r = _convert("components/Navbar.tsx")
    # NavLink is navigation-dependent → recorded as unhandled with a TODO.
    assert "NAV_LINK" in _codes(r)
    assert "NAV_ACTIVE" in _codes(r)  # active-state className function
    assert "REJOX-TODO(NAV_LINK)" in r.code


# --- The non-negotiable: every output is valid TS ---------------------------


@pytest.mark.parametrize("rel", sorted(p.name for p in (SRC / "components").glob("*.tsx")))
def test_every_component_output_is_valid_typescript(rel: str) -> None:
    r = convert_component(SRC / "components" / rel, OPTIONS)
    assert check_syntax(r.code) == 0, f"{rel} produced invalid TS"


@pytest.mark.parametrize("rel", sorted(p.name for p in (SRC / "pages").glob("*.tsx")))
def test_every_page_output_is_valid_typescript(rel: str) -> None:
    r = convert_component(SRC / "pages" / rel, OPTIONS)
    assert check_syntax(r.code) == 0, f"{rel} produced invalid TS"


def test_missing_file_raises() -> None:
    from app.pipeline.converter import ConverterError

    with pytest.raises(ConverterError):
        convert_component(SRC / "components" / "DoesNotExist.tsx", OPTIONS)


# --- Scaffold ---------------------------------------------------------------


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

        import json

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
