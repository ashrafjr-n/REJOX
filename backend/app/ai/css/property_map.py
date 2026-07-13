"""Tier 1 — the declarative CSS → React Native property table.

`.module.css` → RN styles is a **parsing problem, not a reasoning problem**. This
table is the proof: every declaration maps to its RN equivalent by rule, or is
dropped by rule (with a warning — never guessed). Nothing here consults an LLM.

`map_declaration(prop, value)` returns a :class:`DeclResult`:

- ``props``      — the RN ``(name, value)`` pairs this declaration becomes
  (a CSS prop may expand to several — ``box-shadow`` → four shadow props +
  ``elevation``).
- ``clean_drop`` — handled by removal, *losslessly* (``display: flex`` — RN is
  flex by default). No warning.
- ``warning``    — a *lossy* drop: the declaration has no RN equivalent and is
  removed with a recorded reason (``transition``, ``object-fit`` → use
  ``resizeMode``, unknown props).
- ``ambiguous``  — a KNOWN RN property whose value cannot be parsed mechanically;
  only these may reach the LLM tier. In practice, none survive on real input.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

# 1rem/1em ≈ 16px. RN is unitless px, so this is the only unit conversion needed.
_REM_PX = 16.0


@dataclass
class DeclResult:
    props: list[tuple[str, Any]] = field(default_factory=list)
    warning: Optional[str] = None
    clean_drop: bool = False
    ambiguous: bool = False


# --- value normalization -----------------------------------------------------


def _to_number(text: str) -> Optional[float]:
    try:
        return float(text)
    except ValueError:
        return None


def length(value: str) -> Any:
    """A CSS length → an RN value: a number (px) or a ``'…%'`` string.

    ``0.75rem`` → 12, ``2px`` → 2, ``100%`` → ``'100%'``, ``0`` → 0.
    Returns the original string if it is not a plain length (caller decides).
    """
    v = value.strip()
    if v.endswith("%"):
        return v
    m = re.fullmatch(r"(-?\d*\.?\d+)(px|rem|em|pt)?", v)
    if not m:
        return v
    num = float(m.group(1))
    unit = m.group(2)
    if unit in ("rem", "em"):
        num *= _REM_PX
    return int(num) if num == int(num) else num


def _hex_from_rgb(r: int, g: int, b: int) -> str:
    return f"#{r:02x}{g:02x}{b:02x}"


def split_color(color: str) -> tuple[str, Optional[float]]:
    """Return (rn_color, alpha). ``rgba(15,23,42,0.08)`` → ('#0f172a', 0.08)."""
    c = color.strip()
    m = re.fullmatch(r"rgba?\(\s*([^)]*)\)", c, re.IGNORECASE)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        if len(parts) >= 3:
            try:
                r, g, b = (int(float(parts[i])) for i in range(3))
                alpha = float(parts[3]) if len(parts) >= 4 else None
                return _hex_from_rgb(r, g, b), alpha
            except ValueError:
                return c, None
    return c, None


# --- declaration handlers ----------------------------------------------------

# Straight passthrough: CSS prop (kebab) → RN prop (camel), value kept verbatim.
_ENUM_PASSTHROUGH = {
    "flex-direction": "flexDirection",
    "flex-wrap": "flexWrap",
    "justify-content": "justifyContent",
    "align-items": "alignItems",
    "align-self": "alignSelf",
    "align-content": "alignContent",
    "overflow": "overflow",
    "position": "position",
    "text-align": "textAlign",
    "text-transform": "textTransform",
    "font-style": "fontStyle",
    "font-weight": "fontWeight",
    "text-decoration-line": "textDecorationLine",
}

# CSS prop → RN prop, value run through `length`.
_LENGTH_PROPS = {
    "border-radius": "borderRadius",
    "border-top-left-radius": "borderTopLeftRadius",
    "border-top-right-radius": "borderTopRightRadius",
    "border-bottom-left-radius": "borderBottomLeftRadius",
    "border-bottom-right-radius": "borderBottomRightRadius",
    "border-width": "borderWidth",
    "width": "width", "height": "height",
    "min-width": "minWidth", "max-width": "maxWidth",
    "min-height": "minHeight", "max-height": "maxHeight",
    "top": "top", "right": "right", "bottom": "bottom", "left": "left",
    "padding": "padding", "padding-top": "paddingTop",
    "padding-right": "paddingRight", "padding-bottom": "paddingBottom",
    "padding-left": "paddingLeft",
    "margin": "margin", "margin-top": "marginTop",
    "margin-right": "marginRight", "margin-bottom": "marginBottom",
    "margin-left": "marginLeft",
    "gap": "gap", "row-gap": "rowGap", "column-gap": "columnGap",
    "font-size": "fontSize", "line-height": "lineHeight",
    "letter-spacing": "letterSpacing",
}

# Colors → RN color props.
_COLOR_PROPS = {"color": "color", "border-color": "borderColor"}

# Lossy drops: valid CSS with no RN style equivalent → removed WITH a warning.
_LOSSY_DROP = {
    "cursor": "no cursor concept in RN",
    "float": "no float in RN — use flexbox",
    "clear": "no float/clear in RN",
    "user-select": "no user-select style in RN",
    "white-space": "no white-space style; use numberOfLines/ellipsizeMode on <Text>",
    "content": "the ::content property has no RN equivalent",
    "backdrop-filter": "no backdrop-filter; use expo-blur <BlurView>",
    "filter": "no CSS filters in RN",
}


def _handle_box_shadow(value: str) -> DeclResult:
    """`box-shadow: 0 1px 2px rgba(…)` → shadow* props + Android `elevation`."""
    if "," in re.sub(r"\([^)]*\)", "", value):  # multiple shadows (commas outside parens)
        return DeclResult(ambiguous=True)  # genuine reasoning — which shadow wins?
    color_m = re.search(r"(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))\s*$", value)
    color = color_m.group(1) if color_m else "#000000"
    lengths_part = value[: color_m.start()].strip() if color_m else value.strip()
    nums = [length(t) for t in lengths_part.split() if t]
    if len(nums) < 2:
        return DeclResult(ambiguous=True)
    offset_x, offset_y = nums[0], nums[1]
    blur = nums[2] if len(nums) > 2 else 0
    rn_color, alpha = split_color(color)
    blur_n = blur if isinstance(blur, (int, float)) else 0
    return DeclResult(props=[
        ("shadowColor", rn_color),
        ("shadowOffset", {"width": offset_x, "height": offset_y}),
        ("shadowOpacity", alpha if alpha is not None else 0.2),
        ("shadowRadius", blur),
        ("elevation", max(1, round(blur_n))),
    ])


_TRANSFORM_FN = re.compile(r"([a-zA-Z]+)\(([^)]*)\)")


def _handle_transform(value: str) -> DeclResult:
    """`transform: translateY(-2px) scale(1.02)` → RN `transform` array."""
    entries: list[dict[str, Any]] = []
    for name, arg in _TRANSFORM_FN.findall(value):
        arg = arg.strip()
        if name in ("translate",):
            parts = [p.strip() for p in arg.split(",")]
            if parts:
                entries.append({"translateX": length(parts[0])})
            if len(parts) > 1:
                entries.append({"translateY": length(parts[1])})
        elif name in ("rotate", "rotateX", "rotateY", "rotateZ", "skewX", "skewY"):
            entries.append({name: arg})  # RN wants the deg string, e.g. '45deg'
        elif name in ("scale", "scaleX", "scaleY"):
            n = _to_number(arg)
            entries.append({name: n if n is not None else arg})
        else:  # translateX / translateY / perspective / matrix …
            n_or_len = length(arg)
            entries.append({name: n_or_len})
    if not entries:
        return DeclResult(ambiguous=True)
    return DeclResult(props=[("transform", entries)])


def _handle_aspect_ratio(value: str) -> DeclResult:
    m = re.fullmatch(r"\s*(\d*\.?\d+)\s*/\s*(\d*\.?\d+)\s*", value)
    if m:
        num, den = float(m.group(1)), float(m.group(2))
        ratio = num / den if den else num
        return DeclResult(props=[("aspectRatio", int(ratio) if ratio == int(ratio) else round(ratio, 4))])
    n = _to_number(value.strip())
    if n is not None:
        return DeclResult(props=[("aspectRatio", n)])
    return DeclResult(ambiguous=True)


def _handle_background(value: str) -> DeclResult:
    """`background`/`background-color` → `backgroundColor` for a plain color;
    gradients/images have no RN style equivalent → lossy drop."""
    v = value.strip()
    if re.search(r"url\(|gradient\(", v, re.IGNORECASE):
        return DeclResult(warning="CSS background image/gradient — use expo-linear-gradient or an <Image>")
    # Take the first token as the color (ignore background shorthand extras).
    color = v.split()[0] if v.split() else v
    return DeclResult(props=[("backgroundColor", color)])


def _handle_flex(value: str) -> DeclResult:
    parts = value.split()
    if len(parts) == 1:
        n = _to_number(parts[0])
        if n is not None:
            return DeclResult(props=[("flex", int(n) if n == int(n) else n)])
        if parts[0] in ("auto", "none", "initial"):
            return DeclResult(clean_drop=True)
    if len(parts) == 3:  # flex-grow flex-shrink flex-basis
        g, s = _to_number(parts[0]), _to_number(parts[1])
        out: list[tuple[str, Any]] = []
        if g is not None:
            out.append(("flexGrow", g))
        if s is not None:
            out.append(("flexShrink", s))
        out.append(("flexBasis", length(parts[2])))
        return DeclResult(props=out)
    return DeclResult(ambiguous=True)


def map_declaration(prop: str, value: str) -> DeclResult:
    prop = prop.lower().strip()
    value = value.strip()

    if prop == "display":
        if value == "none":
            return DeclResult(props=[("display", "none")])
        if value in ("flex", "block", "inline-flex"):
            return DeclResult(clean_drop=True)  # RN lays out with flex by default
        return DeclResult(warning=f"display: {value} has no RN equivalent")

    if prop == "box-shadow":
        return _handle_box_shadow(value)
    if prop == "transform":
        return _handle_transform(value)
    if prop == "aspect-ratio":
        return _handle_aspect_ratio(value)
    if prop in ("background", "background-color"):
        return _handle_background(value)
    if prop == "flex":
        return _handle_flex(value)

    if prop.startswith("transition") or prop.startswith("animation") or prop == "will-change":
        return DeclResult(warning="RN has no CSS transitions/animations — state changes are instant; animate with Reanimated")
    if prop == "object-fit":
        return DeclResult(warning="use the <Image> `resizeMode` prop (cover/contain) instead of object-fit")
    if prop == "z-index":
        n = _to_number(value)
        return DeclResult(props=[("zIndex", n if n is not None else 0)])
    if prop == "opacity":
        n = _to_number(value)
        return DeclResult(props=[("opacity", n if n is not None else 1)]) if n is not None else DeclResult(ambiguous=True)
    if prop == "font-family":
        return DeclResult(props=[("fontFamily", value.split(",")[0].strip().strip("'\""))])

    if prop in _ENUM_PASSTHROUGH:
        return DeclResult(props=[(_ENUM_PASSTHROUGH[prop], value)])
    if prop in _LENGTH_PROPS:
        return DeclResult(props=[(_LENGTH_PROPS[prop], length(value))])
    if prop in _COLOR_PROPS:
        return DeclResult(props=[(_COLOR_PROPS[prop], value)])
    if prop in _LOSSY_DROP:
        return DeclResult(warning=_LOSSY_DROP[prop])

    # Unknown property: drop it, record a warning — never guess.
    return DeclResult(warning=f"'{prop}' has no known RN equivalent")
