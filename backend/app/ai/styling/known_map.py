"""Tier 1 — the static map.

A declarative table of unsupported Tailwind classes whose React Native
equivalent is **fixed and well-known**. There is no judgment here: ``divide-y``
is always a between-children top border, ``animate-spin`` is always a 360°
rotation, ``backdrop-blur`` is always an ``expo-blur`` layer. Writing these down
as rules is the whole game — every entry keeps a class off the LLM's desk and
raises Confidence, because a rule is auditable and a prompt is not.

Each rule matches a *unit* (the list of classes the orchestrator grouped) and,
when it matches, returns a :class:`LadderResult`. ``resolve`` tries the rules in
order and returns the first hit, or ``None`` to fall through to the pattern tier.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from app.ai.schemas import ResolutionResponse
from app.ai.styling.colors import tw_hex
from app.ai.styling.models import LadderResult, ResolutionTier

# Variant prefixes NativeWind would handle; strip them to see the base class.
_VARIANTS = ("sm:", "md:", "lg:", "xl:", "2xl:", "dark:", "hover:", "focus:", "active:")


def _base(token: str) -> str:
    changed = True
    while changed:
        changed = False
        for v in _VARIANTS:
            if token.startswith(v):
                token = token[len(v):]
                changed = True
    return token


def _result(
    tier: ResolutionTier,
    code: str,
    explanation: str,
    *,
    confidence: str = "high",
    note: str = "",
    unresolvable: bool = False,
    reason: Optional[str] = None,
) -> LadderResult:
    return LadderResult(
        tier=tier,
        response=ResolutionResponse(
            code=code,
            explanation=explanation,
            confidence=confidence,  # type: ignore[arg-type]
            unresolvable=unresolvable,
            reason=reason,
        ),
        note=note,
    )


# --- individual rules --------------------------------------------------------


def _match_divide(classes: list[str]) -> Optional[LadderResult]:
    """``divide-*`` → a between-children border. Mechanical: RN has no
    descendant divider, so the divider becomes a top/left border on every child
    after the first."""
    bases = [_base(c) for c in classes]
    if not bases or not all(b.startswith("divide-") for b in bases):
        return None

    axis = "borderTopWidth"
    color_hex: Optional[str] = None
    for b in bases:
        if b == "divide-x":
            axis = "borderLeftWidth"
        elif b == "divide-y":
            axis = "borderTopWidth"
        elif b in ("divide-x-reverse", "divide-y-reverse"):
            continue
        else:
            # divide-<color> → the divider's color.
            color_hex = tw_hex(b[len("divide-"):]) or color_hex

    fields = [f"{axis}: StyleSheet.hairlineWidth"]
    if color_hex:
        fields.append(f"borderColor: '{color_hex}'")
    code = "{ " + ", ".join(fields) + " }"
    return _result(
        ResolutionTier.STATIC_MAP,
        code,
        "RN has no `divide-*` descendant selector; the divider becomes a hairline "
        "border on each child after the first.",
        note="Apply this style to every child EXCEPT the first (index > 0).",
    )


def _match_animate_spin(classes: list[str]) -> Optional[LadderResult]:
    """``animate-spin`` → a documented Reanimated continuous rotation."""
    if [_base(c) for c in classes] != ["animate-spin"]:
        return None
    code = (
        "const spin = useSharedValue(0);\n"
        "useEffect(() => {\n"
        "  spin.value = withRepeat("
        "withTiming(360, { duration: 1000, easing: Easing.linear }), -1);\n"
        "}, []);\n"
        "const spinStyle = useAnimatedStyle(() => "
        "({ transform: [{ rotate: `${spin.value}deg` }] }));"
    )
    return _result(
        ResolutionTier.STATIC_MAP,
        code,
        "`animate-spin` is a 360° loop; Reanimated expresses it with a repeating "
        "timing on a rotate transform.",
        note=(
            "import { useSharedValue, useAnimatedStyle, withRepeat, withTiming, "
            "Easing } from 'react-native-reanimated'; wrap the element in "
            "<Animated.View style={spinStyle}>."
        ),
    )


def _match_backdrop(classes: list[str]) -> Optional[LadderResult]:
    """``backdrop-blur`` (and siblings) → an ``expo-blur`` ``<BlurView>`` layer."""
    bases = [_base(c) for c in classes]
    if not bases or not all(b.startswith("backdrop-") for b in bases):
        return None
    code = '<BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />'
    return _result(
        ResolutionTier.STATIC_MAP,
        code,
        "RN has no CSS backdrop-filter; expo-blur's <BlurView> renders the same "
        "frosted layer.",
        confidence="medium",
        note=(
            "import { BlurView } from 'expo-blur'; render it as the first, "
            "absolutely-filled child behind the content."
        ),
    )


def _match_position(classes: list[str]) -> Optional[LadderResult]:
    """``sticky`` / ``fixed`` → the nearest RN positioning equivalent + a note."""
    bases = [_base(c) for c in classes]
    if bases == ["sticky"]:
        return _result(
            ResolutionTier.STATIC_MAP,
            "{ position: 'relative' }",
            "RN has no `position: sticky`. Inside a ScrollView, pin the element "
            "with the ScrollView's `stickyHeaderIndices` instead.",
            confidence="medium",
            note="Add this element's index to the parent ScrollView `stickyHeaderIndices`.",
        )
    if bases == ["fixed"]:
        return _result(
            ResolutionTier.STATIC_MAP,
            "{ position: 'absolute', top: 0, left: 0, right: 0 }",
            "RN has no `position: fixed`; an absolutely-positioned, edge-pinned "
            "element is the closest equivalent for an overlay bar.",
            confidence="medium",
        )
    return None


# Motion utilities that RN simply does not model. CSS transitions have no RN
# analogue — state changes are instant unless explicitly animated — so the safe,
# deterministic answer is to DROP the class (emit nothing) with a note.
_TRANSITION_PREFIXES = ("transition", "duration-", "ease-", "delay-")
_OTHER_ANIMATE = {"animate-pulse", "animate-bounce", "animate-ping", "animate-none"}


def _match_motion_drop(classes: list[str]) -> Optional[LadderResult]:
    bases = [_base(c) for c in classes]
    def is_transition(b: str) -> bool:
        return any(b == p or b.startswith(p) for p in _TRANSITION_PREFIXES)

    if all(is_transition(b) for b in bases):
        return _result(
            ResolutionTier.STATIC_MAP,
            "",  # nothing to emit — the class is simply removed
            "RN has no CSS transitions; visual state changes are instant. Dropping "
            "the transition utility is lossless unless the change is animated.",
            note="Removed (no-op). If motion is required, animate with Reanimated.",
        )
    if bases and all(b in _OTHER_ANIMATE for b in bases):
        return _result(
            ResolutionTier.STATIC_MAP,
            "",
            "RN has no keyframe animation for this utility; dropped rather than "
            "guessed. It is decorative, so removal is safe.",
            confidence="low",
            note="Removed. Re-add with Reanimated if the animation matters.",
        )
    return None


@dataclass(frozen=True)
class StaticRule:
    name: str
    apply: Callable[[list[str]], Optional[LadderResult]]


# Order matters: animate-spin before the generic motion drop, etc.
RULES: list[StaticRule] = [
    StaticRule("divide", _match_divide),
    StaticRule("animate-spin", _match_animate_spin),
    StaticRule("backdrop", _match_backdrop),
    StaticRule("position", _match_position),
    StaticRule("motion-drop", _match_motion_drop),
]


def resolve(classes: list[str], options: dict[str, Any]) -> Optional[LadderResult]:
    """Tier 1. Return a :class:`LadderResult` if a static rule matches, else None."""
    for rule in RULES:
        hit = rule.apply(classes)
        if hit is not None:
            return hit
    return None
