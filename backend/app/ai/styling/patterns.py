"""Tier 2 — pattern resolvers.

Structural cases whose RN form is a *deterministic function of their
parameters*. These are not judgment calls — given ``N`` there is exactly one
right flex reflow; given ``from``/``to`` colors and a direction there is exactly
one ``<LinearGradient>``. So they are rules, implemented here, and never reach
the LLM:

- ``hover:*``            → NativeWind ``active:*`` (the pressed-state equivalent)
- ``grid grid-cols-N``   → ``flex-row flex-wrap`` + ``100/N`` %-width children
- ``bg-gradient-* …``    → an ``expo-linear-gradient`` ``<LinearGradient>`` wrapper

Each returns a :class:`LadderResult` (replacement + confidence + note), or
``None`` to fall through to the LLM tier.
"""

from __future__ import annotations

from typing import Any, Optional

from app.ai.schemas import ResolutionResponse
from app.ai.styling.colors import tw_hex
from app.ai.styling.models import LadderResult, ResolutionTier

_VARIANTS = ("sm:", "md:", "lg:", "xl:", "2xl:", "dark:", "focus:", "active:")


def _strip_variants(token: str) -> str:
    """Strip responsive/state prefixes, leaving the base utility."""
    changed = True
    while changed:
        changed = False
        for v in _VARIANTS:
            if token.startswith(v):
                token = token[len(v):]
                changed = True
    return token


def _result(
    code: str,
    explanation: str,
    *,
    confidence: str = "medium",
    note: str = "",
) -> LadderResult:
    return LadderResult(
        tier=ResolutionTier.PATTERN,
        response=ResolutionResponse(
            code=code,
            explanation=explanation,
            confidence=confidence,  # type: ignore[arg-type]
        ),
        note=note,
    )


# --- hover ------------------------------------------------------------------


def is_hover(token: str) -> bool:
    return "hover:" in token


def _resolve_hover(classes: list[str]) -> Optional[LadderResult]:
    if not classes or not all(is_hover(c) for c in classes):
        return None
    # hover:X → active:X, preserving any responsive prefix (sm:hover:X → sm:active:X).
    mapped = [c.replace("hover:", "active:", 1) for c in classes]
    return _result(
        " ".join(mapped),
        "Touch devices have no hover; NativeWind's `active:` variant is the "
        "pressed-state equivalent.",
        note="Element must be a <Pressable> (or Pressable-backed) for `active:` to fire.",
    )


# --- grid -------------------------------------------------------------------

_GRID_PREFIXES = ("grid-cols-", "grid-rows-", "grid-flow-", "col-", "row-",
                  "auto-cols-", "auto-rows-")


def is_grid(token: str) -> bool:
    base = _strip_variants(token)
    return base in ("grid", "inline-grid") or base.startswith(_GRID_PREFIXES)


def _columns(classes: list[str]) -> Optional[int]:
    """Pick the column count for the reflow: prefer the unprefixed (mobile)
    `grid-cols-N`; else the smallest N present (mobile-first)."""
    base_n: Optional[int] = None
    all_n: list[int] = []
    for c in classes:
        stripped = _strip_variants(c)
        if stripped.startswith("grid-cols-"):
            tail = stripped[len("grid-cols-"):]
            if tail.isdigit():
                n = int(tail)
                all_n.append(n)
                if c == stripped:  # unprefixed → the mobile default
                    base_n = n
    if base_n is not None:
        return base_n
    return min(all_n) if all_n else None


def _resolve_grid(classes: list[str]) -> Optional[LadderResult]:
    if not classes or not any(is_grid(c) for c in classes):
        return None
    n = _columns(classes) or 1
    pct = round(100 / n, 4)
    width = f"{pct:g}%"
    return _result(
        "flex-row flex-wrap",
        f"RN has no CSS grid. A {n}-column grid becomes a wrapping flex row; each "
        f"child takes 1/{n} of the width.",
        note=(
            f"Parent: replace grid with `flex-row flex-wrap`. Each child gets "
            f"width {width} (NativeWind `w-[{width}]`). Existing `gap-*` is kept."
        ),
    )


# --- gradient ---------------------------------------------------------------

# bg-gradient-to-XX direction → LinearGradient start/end (0..1 unit square).
_DIRECTIONS: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {
    "to-r": ((0, 0), (1, 0)),
    "to-l": ((1, 0), (0, 0)),
    "to-t": ((0, 1), (0, 0)),
    "to-b": ((0, 0), (0, 1)),
    "to-tr": ((0, 1), (1, 0)),
    "to-tl": ((1, 1), (0, 0)),
    "to-br": ((0, 0), (1, 1)),
    "to-bl": ((1, 0), (0, 1)),
}


def is_gradient(token: str) -> bool:
    base = _strip_variants(token)
    return base.startswith(("bg-gradient-", "from-", "via-", "to-"))


def _point(p: tuple[float, float]) -> str:
    return f"{{ x: {p[0]:g}, y: {p[1]:g} }}"


def _resolve_gradient(classes: list[str]) -> Optional[LadderResult]:
    if not classes or not any(is_gradient(c) for c in classes):
        return None

    start, end = _DIRECTIONS["to-r"]  # Tailwind default is left→right
    from_c = via_c = to_c = None
    for c in classes:
        base = _strip_variants(c)
        if base.startswith("bg-gradient-"):
            key = base[len("bg-gradient-"):]  # e.g. "to-br"
            if key in _DIRECTIONS:
                start, end = _DIRECTIONS[key]
        elif base.startswith("from-"):
            from_c = tw_hex(base[len("from-"):])
        elif base.startswith("via-"):
            via_c = tw_hex(base[len("via-"):])
        elif base.startswith("to-"):
            to_c = tw_hex(base[len("to-"):])

    colors = [c for c in (from_c, via_c, to_c) if c]
    if len(colors) < 2:
        # Can't build a real gradient without ≥2 mapped stops — let the LLM try.
        return None

    colors_js = "[" + ", ".join(f"'{c}'" for c in colors) + "]"
    code = (
        f"<LinearGradient colors={{{colors_js}}} "
        f"start={{{_point(start)}}} end={{{_point(end)}}}>\n"
        "  {/* existing children */}\n"
        "</LinearGradient>"
    )
    return _result(
        code,
        "RN has no CSS gradients; expo-linear-gradient's <LinearGradient> maps the "
        "from/via/to stops and direction directly.",
        note=(
            "import { LinearGradient } from 'expo-linear-gradient'; replace the "
            "gradient-backed element with this wrapper around its children."
        ),
    )


# --- dispatch ---------------------------------------------------------------

_RESOLVERS = (_resolve_hover, _resolve_grid, _resolve_gradient)


def resolve(classes: list[str], options: dict[str, Any]) -> Optional[LadderResult]:
    """Tier 2. Return the first pattern that resolves this unit, else None."""
    for resolver in _RESOLVERS:
        hit = resolver(classes)
        if hit is not None:
            return hit
    return None
