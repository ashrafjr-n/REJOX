"""Navigation resolver — react-router structure → React Navigation, by ladder.

Two of the three residue codes here are rules in disguise (NAV_ACTIVE focus
state; NAV_CONTAINER navigator wiring from the route table). The third —
navigator *shape* — is genuine design, so the LLM decides the shape and returns
a **structured spec**, from which our generator writes the code. The human
confirms via a Planner question. LLM decides shape; rules write code.
"""

from app.ai.navigation.active import resolve_nav_active
from app.ai.navigation.generator import (
    build_navigator_spec,
    generate_navigator,
    stack_spec_from_routes,
    unhoistable_screens,
)
from app.ai.navigation.models import (
    NavigatorSpec,
    NavigatorType,
    NavLinkSummary,
    NavResolution,
    NavTier,
    NavUiSummary,
    NestedNavigator,
)
from app.ai.navigation.resolver import (
    NavShapeProposal,
    build_shape_question,
    infer_navigator_shape,
    resolve_nav_container,
    shape_prompt,
)

__all__ = [
    "NavLinkSummary",
    "NavResolution",
    "NavShapeProposal",
    "NavTier",
    "NavUiSummary",
    "NavigatorSpec",
    "NavigatorType",
    "NestedNavigator",
    "build_navigator_spec",
    "build_shape_question",
    "generate_navigator",
    "infer_navigator_shape",
    "resolve_nav_active",
    "resolve_nav_container",
    "shape_prompt",
    "stack_spec_from_routes",
    "unhoistable_screens",
]
