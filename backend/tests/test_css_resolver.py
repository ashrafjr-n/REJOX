"""CSS Module resolver — `.module.css` → RN StyleSheet is a RULE, not reasoning.

These prove the deterministic path: postcss parses (Node), the declarative table
maps, ts-morph rewrites the references — all with ZERO LLM calls on real input.
The LLM tier is exercised only by a deliberately ambiguous declaration, to show
the ladder's bottom rung exists but is not the default path.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.ai.css import resolve_css_module, rewrite_component_source
from app.ai.css.property_map import length, map_declaration, split_color
from app.ai.provider import FakeProvider

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE = REPO_ROOT / "test-projects" / "sample-app" / "src" / "components"
CSS = SAMPLE / "ProductCard.module.css"
COMPONENT = SAMPLE / "ProductCard.tsx"


def _needs_node() -> None:
    import shutil

    if not (shutil.which("node") and shutil.which("npm")):
        pytest.skip("node/npm not on PATH")


# --- Pure unit: the property table (no Node) --------------------------------


def test_length_normalizes_units() -> None:
    assert length("0.75rem") == 12
    assert length("2px") == 2
    assert length("100%") == "100%"
    assert length("0") == 0
    assert length("-2px") == -2


def test_box_shadow_maps_to_shadow_and_elevation() -> None:
    r = map_declaration("box-shadow", "0 1px 2px rgba(15, 23, 42, 0.08)")
    props = dict(r.props)
    assert props["shadowColor"] == "#0f172a"
    assert props["shadowOffset"] == {"width": 0, "height": 1}
    assert props["shadowRadius"] == 2
    assert props["shadowOpacity"] == pytest.approx(0.08)
    assert props["elevation"] == 2  # Android needs elevation, not shadow*


def test_transition_is_dropped_with_a_warning() -> None:
    r = map_declaration("transition", "transform 0.15s ease")
    assert r.props == []
    assert r.warning and "transition" in r.warning.lower()


def test_multi_shadow_is_ambiguous_reaches_llm_tier() -> None:
    r = map_declaration("box-shadow", "0 1px 2px #000, 0 8px 20px #111")
    assert r.ambiguous is True  # which shadow wins is a judgment → LLM tier


def test_split_color_extracts_alpha() -> None:
    assert split_color("rgba(15, 23, 42, 0.08)") == ("#0f172a", pytest.approx(0.08))
    assert split_color("#abcdef") == ("#abcdef", None)


# --- End-to-end: the real CSS module (needs Node/postcss) -------------------


def test_productcard_css_converts_to_stylesheet_zero_llm() -> None:
    _needs_node()
    provider = FakeProvider()
    res = resolve_css_module(
        CSS, module="./ProductCard.module.css", provider=provider
    )
    assert provider.calls == 0, "CSS Modules are pure parsing — no LLM"
    assert res.llmCalls == 0
    assert res.tiers["static_map"] >= 2  # .card + .thumb
    assert res.tiers["pattern"] == 1     # .card:hover → pressed variant

    body = res.styleSheetBody
    # box-shadow → shadow/elevation mapping landed in the StyleSheet.
    assert "shadowColor: '#0f172a'" in body
    assert "elevation:" in body
    assert "borderRadius: 12" in body           # 0.75rem → 12
    assert "aspectRatio: 1" in body
    assert "StyleSheet.create(" in res.styleSheetSource

    # The pressed variant exists and is documented.
    assert any(s.name == "cardPressed" and s.pressed for s in res.styles)
    assert any("Pressable" in n for n in res.notes)


def test_dropped_props_are_warned_never_guessed() -> None:
    _needs_node()
    res = resolve_css_module(CSS, module="./ProductCard.module.css")
    codes = {w.code for w in res.warnings}
    msgs = " ".join(w.message for w in res.warnings)
    assert "CSS_DROP" in codes
    assert "transition" in msgs and "object-fit" in msgs  # both dropped w/ reason


def test_component_references_are_rewritten() -> None:
    _needs_node()
    res = resolve_css_module(CSS, module="./ProductCard.module.css")
    out = rewrite_component_source(COMPONENT, "./ProductCard.module.css", res)
    # CSS-module import gone; StyleSheet inlined; className={styles.X} → style=.
    assert "import styles from './ProductCard.module.css'" not in out
    assert "StyleSheet.create(" in out
    assert "import { StyleSheet } from 'react-native'" in out
    assert "style={styles.card}" in out
    assert "style={styles.thumb}" in out
    assert "className={styles.card}" not in out
    # A Tailwind className (not a styles.* ref) is left untouched.
    assert "className=" in out


def test_ambiguous_declaration_reaches_the_llm_when_a_provider_is_present() -> None:
    # No Node: drive the resolver's LLM tier directly with a synthetic ParsedCss.
    from app.ai.css.models import CssDecl, CssRule, ParsedCss
    from app.ai.css.resolver import CssModuleResolver

    provider = FakeProvider()
    system = (
        "You convert ONE CSS declaration into React Native style props. "
        "Output ONLY a JSON object of RN style props in camelCase, e.g. "
        '{"shadowColor": "#000", "shadowRadius": 4}. If it cannot be '
        "expressed, output {}."
    )
    user = "box-shadow: 0 1px 2px #000, 0 8px 20px #111"
    provider.register(system, user, '{"shadowColor": "#000000", "shadowRadius": 2}')

    parsed = ParsedCss(rules=[CssRule(
        selector=".x", className="x", pseudo=None,
        decls=[CssDecl(prop="box-shadow", value="0 1px 2px #000, 0 8px 20px #111")],
    )])
    res = CssModuleResolver(provider=provider).resolve(parsed, "./x.module.css")
    assert provider.calls == 1
    assert res.tiers["llm"] == 1
    assert res.styles[0].props.get("shadowColor") == "#000000"
