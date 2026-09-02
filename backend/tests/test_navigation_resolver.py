"""Navigation resolver — the three-tier ladder.

Two residue codes turn out to be rules (NAV_ACTIVE focus state; NAV_CONTAINER
navigator wiring). The third — navigator *shape* — is genuine reasoning, so the
LLM is called, but the contract is strict: it returns a **validated spec, not
code**, and our generator writes the code. These tests pin that contract.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.ai.navigation import (
    NavLinkSummary,
    NavTier,
    NavUiSummary,
    infer_navigator_shape,
    resolve_nav_active,
    resolve_nav_container,
    stack_spec_from_routes,
    unhoistable_screens,
)
from app.ai.provider import LLMProvider, LLMResponse
from app.models.analysis import RouteMapping
from app.models.knowledge_graph import RouteElementProp, RouteHostState

ROUTES = [
    RouteMapping(screenName="Home", componentName="HomePage", path="/"),
    RouteMapping(screenName="Products", componentName="ProductsPage", path="products"),
    RouteMapping(screenName="ProductDetail", componentName="ProductDetailPage",
                 path="products/:id", params=["id"], hasParams=True),
    RouteMapping(screenName="Settings", componentName="SettingsPage", path="settings"),
]
NAV_UI = NavUiSummary(
    component="Navbar",
    persistent=True,
    links=[
        NavLinkSummary(label="Home", to="/"),
        NavLinkSummary(label="Products", to="/products"),
        NavLinkSummary(label="Settings", to="/settings"),
    ],
)
SCREENS = {"Home", "Products", "ProductDetail", "Settings"}


class QueueProvider(LLMProvider):
    """Returns queued texts in order, counting calls — for the LLM shape tier."""

    def __init__(self, texts: list[str]) -> None:
        self.texts = texts
        self.calls = 0

    def complete(self, system: str, user: str, *, max_tokens: int) -> LLMResponse:
        text = self.texts[min(self.calls, len(self.texts) - 1)]
        self.calls += 1
        return LLMResponse(text=text, model="fake", tokensIn=1, tokensOut=1)


def _spec_json(**kw) -> str:
    base = {"type": "tabs", "screens": ["Home", "Products", "Settings"],
            "nested": [], "rationale": "3 links → tabs"}
    base.update(kw)
    return json.dumps(base)


def _has_node() -> bool:
    import shutil

    return bool(shutil.which("node") and shutil.which("npm"))


# --- Tier 1: NAV_ACTIVE is a rule -------------------------------------------


def test_nav_active_resolves_via_rule_zero_llm() -> None:
    res = resolve_nav_active("({ isActive }) => isActive ? 'on' : 'off'")
    assert res.tier is NavTier.RULE
    assert "useIsFocused" in res.response.code
    assert res.response.unresolvable is False


# --- Tier 2: NAV_CONTAINER wiring is a rule ---------------------------------


def test_nav_container_generates_navigator_from_route_table_zero_llm() -> None:
    res = resolve_nav_container(ROUTES)
    assert res.tier is NavTier.RULE
    src = res.navigatorSource
    assert "createNativeStackNavigator" in src
    for screen in ("Home", "Products", "ProductDetail", "Settings"):
        assert f'name="{screen}"' in src
    assert "REJOX-TODO" not in src  # complete — no NAV_CONTAINER TODO survives


# --- Route element props: relocated where provable, TODO where not ----------

_DARK_MODE = RouteHostState(value="darkMode", setter="setDarkMode", initializer="false")


def _settings_carrying(*props: RouteElementProp, state: list[RouteHostState] | None = None):
    """The route table, with Settings carrying `props` from the routing component."""
    return [
        *ROUTES[:3],
        RouteMapping(
            screenName="Settings", componentName="SettingsPage", path="settings",
            elementProps=list(props),
            hostState=[_DARK_MODE] if state is None else state,
        ),
    ]


def test_route_element_props_are_relocated_into_the_navigator() -> None:
    """A `Screen` takes a component, so the state moves with the routing half.

    `component={SettingsPage}` would drop `darkMode`/`setDarkMode` on the floor
    and fail tsc; the render-callback form keeps the props, and the `useState`
    that fed them comes along, because AppNavigator is what `App`'s routing half
    became. Zero LLM — the binding is a plain read, so this is a relocation.
    """
    routes = _settings_carrying(
        RouteElementProp(name="darkMode", binding="darkMode"),
        RouteElementProp(name="setDarkMode", binding="setDarkMode"),
    )
    src = resolve_nav_container(routes).navigatorSource

    assert "import { useState } from 'react';" in src
    assert "const [darkMode, setDarkMode] = useState(false);" in src
    assert "{() => <SettingsPage darkMode={darkMode} setDarkMode={setDarkMode} />}" in src
    assert "component={SettingsPage}" not in src
    assert "REJOX-TODO" not in src


def test_a_prop_that_is_not_plain_state_leaves_a_todo() -> None:
    """Anything richer than a read is design: it gets a TODO, never a guess."""
    routes = _settings_carrying(RouteElementProp(name="user", binding=None))
    src = resolve_nav_container(routes).navigatorSource

    assert "REJOX-TODO(NAV_SCREEN_PROPS)" in src
    assert "user" in src
    assert "useState" not in src  # nothing was invented to satisfy it
    assert "component={SettingsPage}" in src  # the screen is still registered


def test_screens_without_element_props_stay_plain_lines() -> None:
    src = resolve_nav_container(ROUTES).navigatorSource
    assert "useState" not in src
    assert "component={HomePage}" in src


def test_unhoistable_screens_names_only_what_it_cannot_place() -> None:
    resolvable = _settings_carrying(RouteElementProp(name="darkMode", binding="darkMode"))
    unresolvable = _settings_carrying(RouteElementProp(name="user", binding=None))

    assert unhoistable_screens(stack_spec_from_routes(resolvable), resolvable) == []
    assert unhoistable_screens(stack_spec_from_routes(unresolvable), unresolvable) == ["Settings"]


def test_generated_navigator_with_relocated_state_is_valid_typescript() -> None:
    if not _has_node():
        pytest.skip("node/npm not on PATH")
    from app.pipeline.transformer import check_syntax

    routes = _settings_carrying(
        RouteElementProp(name="darkMode", binding="darkMode"),
        RouteElementProp(name="setDarkMode", binding="setDarkMode"),
    )
    assert check_syntax(resolve_nav_container(routes).navigatorSource) == 0


def test_generated_stack_navigator_is_valid_typescript() -> None:
    if not _has_node():
        pytest.skip("node/npm not on PATH")
    from app.pipeline.transformer import check_syntax

    res = resolve_nav_container(ROUTES)
    assert check_syntax(res.navigatorSource) == 0


# --- Tier 3: navigator shape is genuine reasoning (LLM IS called) -----------


def test_shape_inference_calls_the_llm_and_generates_tabs() -> None:
    provider = QueueProvider([_spec_json(
        nested=[{"type": "stack", "parent": "Products",
                 "screens": ["Products", "ProductDetail"]}],
    )])
    proposal = infer_navigator_shape(ROUTES, NAV_UI, provider=provider)
    assert provider.calls == 1  # this IS the legitimate LLM case
    assert proposal.resolution.tier is NavTier.LLM_SHAPE
    assert proposal.resolution.spec.type.value == "tabs"
    src = proposal.resolution.navigatorSource
    assert "createBottomTabNavigator" in src
    assert "ProductsNavigator" in src  # the nested stack


def test_llm_raw_text_never_lands_in_the_generated_navigator() -> None:
    sentinel = "RAW_LLM_PROSE_MUST_NOT_APPEAR_1234"
    # Valid spec, but rationale carries prose we must not emit as code.
    provider = QueueProvider([_spec_json(rationale=sentinel)])
    proposal = infer_navigator_shape(ROUTES, NAV_UI, provider=provider)
    assert sentinel not in proposal.resolution.navigatorSource
    # The prose is allowed in the human-facing question context, not the code.
    assert sentinel in proposal.question.context


def test_malformed_spec_is_rejected_and_retried_once() -> None:
    provider = QueueProvider(["not json at all {", _spec_json()])
    proposal = infer_navigator_shape(ROUTES, NAV_UI, provider=provider)
    assert provider.calls == 2, "exactly one retry"
    assert proposal.fellBack is False
    assert proposal.resolution.spec.type.value == "tabs"


def test_two_malformed_specs_fall_back_to_deterministic_stack() -> None:
    provider = QueueProvider(["garbage", "still garbage"])
    proposal = infer_navigator_shape(ROUTES, NAV_UI, provider=provider)
    assert provider.calls == 2  # initial + one retry, then give up
    assert proposal.fellBack is True
    assert proposal.resolution.spec.type.value == "stack"
    assert "createNativeStackNavigator" in proposal.resolution.navigatorSource


def test_spec_may_not_invent_screens_outside_the_route_table() -> None:
    from app.ai.navigation import NavigatorSpec

    spec = NavigatorSpec.model_validate(
        {"type": "tabs", "screens": ["Home", "Ghost"], "nested": [], "rationale": "x"}
    )
    with pytest.raises(ValueError):
        spec.validate_against_routes(SCREENS)


def test_shape_question_hands_the_decision_to_the_human() -> None:
    provider = QueueProvider([_spec_json()])
    proposal = infer_navigator_shape(ROUTES, NAV_UI, provider=provider)
    q = proposal.question
    assert q.id == "navigator-shape"
    ids = {o.id for o in q.options}
    assert {"tabs", "stack", "drawer"} <= ids
    # The LLM's proposed shape is the recommended option, but the user chooses.
    recommended = [o.id for o in q.options if o.isRecommended]
    assert recommended == ["tabs"]


def test_default_stack_spec_mirrors_the_route_table() -> None:
    spec = stack_spec_from_routes(ROUTES)
    assert spec.type.value == "stack"
    assert spec.screens == ["Home", "Products", "ProductDetail", "Settings"]
