"""Navigation resolver — the three-tier ladder.

- **Tier 1 (rule)** — ``resolve_nav_active``: ``isActive`` → focus state.
- **Tier 2 (rule)** — ``resolve_nav_container``: generate the navigator wiring
  from the route table. Mechanical; no TODO survives for the standard case.
- **Tier 3 (LLM — genuinely reasoning)** — ``infer_navigator_shape``: the
  *topology* choice (tabs vs stack vs drawer) is design. The LLM returns a
  **structured spec, not code**; our generator writes the code from it, and the
  proposal is surfaced to the user as a Planner question — the human decides.

The tier-3 safety contract, enforced here: the LLM's output is parsed into a
:class:`NavigatorSpec`, validated against the route table (a malformed or
screen-inventing spec is rejected and retried once, then falls back to a
deterministic stack), and only the *validated spec* feeds the generator. Raw LLM
prose never reaches the emitted navigator.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Optional

from app.ai.cache import ResolutionCache
from app.ai.navigation.active import resolve_nav_active
from app.ai.navigation.generator import generate_navigator, stack_spec_from_routes
from app.ai.navigation.models import (
    NavigatorSpec,
    NavResolution,
    NavTier,
    NavUiSummary,
)
from app.ai.provider import LLMProvider
from app.ai.schemas import ResolutionResponse
from app.models.analysis import RouteMapping
from app.models.plan import Question, QuestionOption

_FENCE_RE = re.compile(r"^```[a-zA-Z0-9]*\n?|\n?```$", re.MULTILINE)
NAV_SHAPE_ISSUE = "NAV_CONTAINER"
SHAPE_MAX_TOKENS = 512

__all__ = [
    "resolve_nav_active",
    "resolve_nav_container",
    "infer_navigator_shape",
    "build_shape_question",
    "shape_prompt",
    "NavShapeProposal",
]


# --- Tier 2: navigator wiring from the route table ---------------------------


def resolve_nav_container(
    routes: list[RouteMapping], options: Optional[dict[str, Any]] = None
) -> NavResolution:
    """Deterministic navigator wiring (default: a flat stack). No LLM, no TODO."""
    spec = stack_spec_from_routes(routes)
    source = generate_navigator(spec, routes)
    return NavResolution(
        issueCode=NAV_SHAPE_ISSUE,
        tier=NavTier.RULE,
        response=ResolutionResponse(
            code=source,
            explanation="Navigator generated from the route table; screen wiring is mechanical.",
            confidence="high",
        ),
        note="The navigator SHAPE (stack vs tabs vs drawer) can be upgraded — see infer_navigator_shape.",
        navigatorSource=source,
        spec=spec,
    )


# --- Tier 3: navigator-shape inference (LLM decides shape, rules write code) --


@dataclass
class NavShapeProposal:
    resolution: NavResolution
    question: Question
    llmCalls: int
    fellBack: bool


def _build_system() -> str:
    return (
        "You are a React Native navigation architect. Given a route table and a "
        "summary of the source app's navigation UI, decide the navigator "
        "TOPOLOGY. Output ONLY a JSON object with this shape:\n"
        '{"type": "stack"|"tabs"|"drawer", "screens": ["<top-level screen names>"], '
        '"nested": [{"type": "stack", "parent": "<screen>", "screens": ["<screen>"]}], '
        '"rationale": "<one sentence>"}\n'
        "Use ONLY screen names from the route table — never invent screens. "
        "Heuristics: a persistent top nav with 3–5 top-level links → bottom tabs; "
        "detail routes nested under a list → a nested stack; a sidebar → a drawer. "
        "No text outside the JSON."
    )


def _build_user(routes: list[RouteMapping], nav_ui: NavUiSummary, options: dict[str, Any]) -> str:
    table = "\n".join(
        f"  - {r.screenName} (path: {r.path or '/'}, params: {r.params or 'none'})"
        for r in routes if r.componentName
    )
    links = ", ".join(f"{l.label}→{l.to}" for l in nav_ui.links) or "none"
    return (
        f"Route table:\n{table}\n\n"
        f"Nav UI: component '{nav_ui.component}', persistent={nav_ui.persistent}, "
        f"sidebar={nav_ui.hasSidebar}, top-level links: {links}\n\n"
        f"Target options: {options}"
    )


def shape_prompt(
    routes: list[RouteMapping],
    nav_ui: NavUiSummary,
    options: Optional[dict[str, Any]] = None,
) -> tuple[str, str]:
    """The exact (system, user) prompt ``infer_navigator_shape`` sends on its
    first attempt. Public so an offline provider can be seeded deterministically
    (the CLI's ``fake`` mode, tests) without duplicating prompt text."""
    return _build_system(), _build_user(routes, nav_ui, dict(options or {}))


def _parse_spec(text: str, screen_names: set[str]) -> NavigatorSpec:
    code = _FENCE_RE.sub("", text).strip()
    data = json.loads(code)  # raises on malformed JSON
    spec = NavigatorSpec.model_validate(data)  # raises on schema violation
    spec.validate_against_routes(screen_names)  # raises on invented screens
    return spec


def infer_navigator_shape(
    routes: list[RouteMapping],
    nav_ui: NavUiSummary,
    options: Optional[dict[str, Any]] = None,
    *,
    provider: LLMProvider,
    cache: Optional[ResolutionCache] = None,
    syntax_check: Optional[Callable[[str], int]] = None,
) -> NavShapeProposal:
    """Tier 3. Ask the LLM for a navigator SPEC, validate it, generate the code."""
    options = dict(options or {})
    screen_names = {r.screenName for r in routes if r.componentName}
    system = _build_system()
    user = _build_user(routes, nav_ui, options)

    calls = 0
    spec: Optional[NavigatorSpec] = None
    error: Optional[str] = None

    for attempt in range(2):  # initial + one retry
        prompt = user if attempt == 0 else (
            f"{user}\n\nYour previous answer was rejected: {error}\n"
            "Return a corrected JSON spec using only route-table screen names."
        )
        raw = provider.complete(system, prompt, max_tokens=SHAPE_MAX_TOKENS)
        calls += 1
        try:
            spec = _parse_spec(raw.text, screen_names)
            break
        except (json.JSONDecodeError, ValueError) as exc:
            error = str(exc)
            spec = None

    fell_back = spec is None
    if spec is None:
        # Rejected after one retry → deterministic default. Never emit LLM prose.
        spec = stack_spec_from_routes(routes)

    source = generate_navigator(spec, routes)
    if syntax_check is not None and syntax_check(source) != 0:  # generator is trusted
        spec = stack_spec_from_routes(routes)
        source = generate_navigator(spec, routes)
        fell_back = True

    resolution = NavResolution(
        issueCode=NAV_SHAPE_ISSUE,
        tier=NavTier.LLM_SHAPE,
        response=ResolutionResponse(
            code=source,
            explanation=(
                spec.rationale
                or "Navigator generated from the validated shape spec."
            ),
            confidence="medium" if not fell_back else "low",
        ),
        note=(
            "Surfaced to the user as a Planner question — the LLM proposes the "
            "shape; the human confirms it."
        ),
        navigatorSource=source,
        spec=spec,
    )
    return NavShapeProposal(
        resolution=resolution,
        question=build_shape_question(spec, nav_ui),
        llmCalls=calls,
        fellBack=fell_back,
    )


def build_shape_question(spec: NavigatorSpec, nav_ui: NavUiSummary) -> Question:
    """A Planner-style question that hands the shape decision to the human, with
    the LLM's rationale as context."""
    proposed = spec.type.value
    options = [
        QuestionOption(
            id="tabs",
            label="Bottom tab navigator",
            description="Each top-level route is a bottom tab; detail routes nest in a stack.",
            tradeoffs="Best for 3–5 primary destinations; matches a persistent top nav.",
            isRecommended=proposed == "tabs",
        ),
        QuestionOption(
            id="stack",
            label="Stack navigator",
            description="One stack; screens push/pop with a header back button.",
            tradeoffs="Simplest; best for linear/drill-down flows.",
            isRecommended=proposed == "stack",
        ),
        QuestionOption(
            id="drawer",
            label="Drawer navigator",
            description="A side drawer lists top-level routes.",
            tradeoffs="Best when there are many destinations or a sidebar in the source.",
            isRecommended=proposed == "drawer",
        ),
    ]
    return Question(
        id="navigator-shape",
        title="Which navigator shape should the app use?",
        context=(
            f"The source nav ('{nav_ui.component}') has {len(nav_ui.links)} top-level "
            f"link(s). Rejox proposes a **{proposed}** navigator: {spec.rationale}"
        ),
        options=options,
        required=True,
    )
