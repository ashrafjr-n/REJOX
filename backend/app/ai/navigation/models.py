"""Navigation resolver — contracts.

The load-bearing type is :class:`NavigatorSpec`: the **structured spec the LLM
returns**, never code. The LLM decides the navigator *shape* (a genuine design
judgment); our deterministic generator writes the *code* from this validated
spec. That separation is the whole safety story — a malformed spec is rejected,
and free-form LLM prose can never reach the emitted source because every field
here is constrained (types are an enum; screen names must be route-table names).
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.ai.schemas import ResolutionResponse


class NavBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NavTier(str, Enum):
    RULE = "rule"          # tiers 1–2: deterministic (active state / navigator wiring)
    LLM_SHAPE = "llm"      # tier 3: navigator-shape inference (genuine reasoning)


class NavigatorType(str, Enum):
    STACK = "stack"
    TABS = "tabs"
    DRAWER = "drawer"


class NestedNavigator(NavBase):
    """A navigator nested under a top-level screen (e.g. a Stack inside a Tab)."""

    type: NavigatorType = NavigatorType.STACK
    parent: str                       # the top-level screen that hosts it
    screens: list[str] = Field(default_factory=list)


class NavigatorSpec(NavBase):
    """The navigator topology — the LLM's structured decision, validated here.

    This is deliberately small and closed: a type from a fixed enum, a list of
    screen names, optional nesting, and a short rationale. It carries NO code.
    """

    type: NavigatorType
    screens: list[str] = Field(default_factory=list)
    nested: list[NestedNavigator] = Field(default_factory=list)
    rationale: str = ""

    @model_validator(mode="after")
    def _non_empty(self) -> "NavigatorSpec":
        if not self.screens:
            raise ValueError("NavigatorSpec.screens must not be empty.")
        return self

    def validate_against_routes(self, screen_names: set[str]) -> None:
        """Every screen the spec names must exist in the route table — the LLM
        may choose the *shape*, never invent screens."""
        named = set(self.screens)
        for n in self.nested:
            named.add(n.parent)
            named.update(n.screens)
        unknown = named - screen_names
        if unknown:
            raise ValueError(
                f"NavigatorSpec references screens not in the route table: {sorted(unknown)}"
            )


class NavLinkSummary(NavBase):
    label: str
    to: str


class NavUiSummary(NavBase):
    """A structured summary of the source nav UI — NOT the file.

    This is all the LLM sees of the component: how many top-level links, whether
    the nav is persistent, and whether a sidebar/drawer is present. Enough to
    judge topology, nothing more.
    """

    component: str
    links: list[NavLinkSummary] = Field(default_factory=list)
    persistent: bool = False
    hasSidebar: bool = False


class NavResolution(NavBase):
    """The navigation resolver's answer for a piece of nav residue."""

    issueCode: str
    tier: NavTier
    response: ResolutionResponse
    note: str = ""
    # For NAV_CONTAINER shape inference: the generated navigator + its spec.
    navigatorSource: Optional[str] = None
    spec: Optional[NavigatorSpec] = None
