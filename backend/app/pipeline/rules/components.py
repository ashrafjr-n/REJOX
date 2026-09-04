"""Component rules.

Per-component analysis over KG facts: web-only JSX elements, event handlers,
styling (delegated to ``styling`` rules), and browser-API usage. Declarative
element/event maps drive severity so the logic stays data-first.
"""

from __future__ import annotations

from app.models.analysis import ComponentFinding, Evidence, Issue
from app.models.knowledge_graph import Component, KnowledgeGraph

from . import codes
from .scoring import score_component
from .styling import component_styling_issues, project_defined_classes

# Host elements that map 1:1 with a trivial rename (div→View, span/p→Text, ...).
# Present here = silent, fully supported, no issue emitted.
TRIVIAL_ELEMENTS = frozenset({
    "div", "span", "p", "section", "header", "footer", "nav", "main",
    "article", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
    "br", "hr", "strong", "em", "b", "i", "small", "label", "figure",
    "figcaption", "blockquote", "pre", "code", "abbr", "time", "mark", "sub",
    "sup", "dl", "dt", "dd",
})

# element → (rn equivalent, severity). severity drives difficulty/score.
ELEMENT_MAP: dict[str, tuple[str, str]] = {
    # Easy conversions (info) — a real but mechanical change.
    "img": ("Image", "info"),
    "picture": ("Image", "info"),
    "a": ("Pressable + Linking", "info"),
    "button": ("Pressable", "info"),
    "input": ("TextInput", "info"),
    "textarea": ("TextInput (multiline)", "info"),
    # Needs a component/library swap (warning).
    "select": ("@react-native-picker/picker", "warning"),
    "form": ("View + state (no native form submit)", "warning"),
    "video": ("expo-av Video", "warning"),
    "audio": ("expo-av Audio", "warning"),
    "svg": ("react-native-svg", "warning"),
    # No RN equivalent in the MVP (blocker).
    "table": ("—", "blocker"),
    "thead": ("—", "blocker"),
    "tbody": ("—", "blocker"),
    "tfoot": ("—", "blocker"),
    "tr": ("—", "blocker"),
    "td": ("—", "blocker"),
    "th": ("—", "blocker"),
    "caption": ("—", "blocker"),
    "canvas": ("—", "blocker"),
    "iframe": ("—", "blocker"),
    "embed": ("—", "blocker"),
    "object": ("—", "blocker"),
}

# event → (rn equivalent, severity).
EVENT_MAP: dict[str, tuple[str, str]] = {
    "onClick": ("onPress", "info"),
    "onChange": ("onChangeText / onValueChange", "info"),
    "onFocus": ("onFocus", "info"),
    "onBlur": ("onBlur", "info"),
    "onInput": ("onChangeText", "info"),
    # Web-only interaction events (warning).
    "onSubmit": ("no form submit — handle in state", "warning"),
    "onMouseEnter": ("no hover on touch", "warning"),
    "onMouseLeave": ("no hover on touch", "warning"),
    "onMouseOver": ("no hover on touch", "warning"),
    "onMouseOut": ("no hover on touch", "warning"),
    "onMouseMove": ("no mouse on touch", "warning"),
    "onDoubleClick": ("no double-click; use gestures", "warning"),
    "onContextMenu": ("no context menu; use long-press", "warning"),
    "onWheel": ("no wheel on touch", "warning"),
    "onScroll": ("ScrollView onScroll", "warning"),
    "onKeyDown": ("limited keyboard events in RN", "warning"),
    "onKeyUp": ("limited keyboard events in RN", "warning"),
    "onKeyPress": ("limited keyboard events in RN", "warning"),
}


def _element_issues(comp: Component) -> list[Issue]:
    issues: list[Issue] = []
    for tag, count in sorted(comp.jsxElements.items()):
        if tag in TRIVIAL_ELEMENTS:
            continue
        if tag in ELEMENT_MAP:
            rn, severity = ELEMENT_MAP[tag]
            code = codes.WEB_ONLY_ELEMENT if severity == "blocker" else codes.ELEMENT_CONVERSION
            target = f"→ {rn}" if rn != "—" else "has no RN equivalent (MVP)"
            issues.append(
                Issue(
                    code=code,
                    severity=severity,  # type: ignore[arg-type]
                    message=f"<{tag}> {target}.",
                    evidence=Evidence(file=comp.file, detail=f"<{tag}> ×{count}"),
                )
            )
        else:
            issues.append(
                Issue(
                    code=codes.ELEMENT_CONVERSION,
                    severity="info",
                    message=f"<{tag}> is an unrecognised host element; verify RN equivalent.",
                    evidence=Evidence(file=comp.file, detail=f"<{tag}> ×{count}"),
                )
            )
    return issues


def _event_issues(comp: Component) -> list[Issue]:
    issues: list[Issue] = []
    for handler in comp.eventHandlers:
        rn, severity = EVENT_MAP.get(handler, ("verify RN equivalent", "info"))
        code = codes.WEB_ONLY_EVENT if severity == "warning" else codes.EVENT_CONVERSION
        issues.append(
            Issue(
                code=code,
                severity=severity,  # type: ignore[arg-type]
                message=f"{handler} → {rn}.",
                evidence=Evidence(file=comp.file, detail=f"handler: {handler}"),
            )
        )
    return issues


def _web_api_issues(comp: Component) -> list[Issue]:
    if not comp.webApis:
        return []
    return [
        Issue(
            code=codes.WEB_API_USAGE,
            severity="warning",
            message=(
                f"Browser API(s) used ({', '.join(comp.webApis)}); "
                "no RN equivalent (e.g. localStorage → AsyncStorage)."
            ),
            evidence=Evidence(file=comp.file, detail=f"web APIs: {', '.join(comp.webApis)}"),
        )
    ]


# CSS properties with no clean React Native equivalent.
RN_INCOMPATIBLE_CSS_PROPS = frozenset({
    "cursor", "float", "clear", "boxShadow", "textShadow", "transition",
    "transitionProperty", "transitionDuration", "animation", "filter",
    "backdropFilter", "backgroundImage", "background", "clipPath", "content",
    "overflowX", "overflowY", "whiteSpace", "wordBreak", "textOverflow",
    "listStyle", "willChange", "userSelect", "appearance", "outline",
})


def _text_wrap_issues(comp: Component) -> list[Issue]:
    bare = [t for t in comp.textNodes if t.isBare]
    if not bare:
        return []
    sample = ", ".join(sorted({t.text for t in bare})[:3])
    return [
        Issue(
            code=codes.MISSING_TEXT_WRAP,
            severity="info",  # the codemod wraps these deterministically
            message=(
                f"{len(bare)} bare text child(ren) must be wrapped in <Text> for RN "
                "(auto-handled by the codemod)."
            ),
            evidence=Evidence(file=comp.file, detail=f"e.g. {sample}"),
        )
    ]


def _flex_row_issues(comp: Component) -> list[Issue]:
    implicit = [
        h for h in comp.layoutHints
        if h.hasFlexClass and h.flexDirection is None and not h.isGrid
    ]
    if not implicit:
        return []
    tags = ", ".join(sorted({h.elementTag for h in implicit}))
    return [
        Issue(
            code=codes.IMPLICIT_FLEX_ROW,
            severity="info",  # the transformer appends flex-row deterministically
            message=(
                f"{len(implicit)} flex container(s) rely on web's default row; RN "
                "defaults to column (auto-handled: the transformer appends flex-row)."
            ),
            evidence=Evidence(file=comp.file, detail=f"elements: {tags}"),
        )
    ]


def _image_issues(comp: Component) -> list[Issue]:
    unsized = [i for i in comp.images if not i.hasExplicitSize]
    if not unsized:
        return []
    return [
        Issue(
            code=codes.UNSIZED_IMAGE,
            severity="warning",
            message=(
                f"{len(unsized)} <img> without an explicit size; RN <Image> needs "
                "width/height or it renders 0×0."
            ),
            evidence=Evidence(
                file=comp.file,
                detail="src: " + ", ".join(i.src or "?" for i in unsized),
            ),
        )
    ]


def _inline_style_issues(comp: Component) -> list[Issue]:
    issues: list[Issue] = []
    for style in comp.inlineStyles:
        bad = sorted(RN_INCOMPATIBLE_CSS_PROPS.intersection(style.properties))
        if not bad:
            continue
        issues.append(
            Issue(
                code=codes.RN_INCOMPATIBLE_CSS_PROP,
                severity="warning",
                message=(
                    f"<{style.elementTag}> uses inline CSS props with no RN "
                    f"equivalent: {', '.join(bad)}."
                ),
                evidence=Evidence(file=comp.file, detail=f"props: {', '.join(bad)}"),
            )
        )
    return issues


def analyze_component(
    comp: Component, project_classes: frozenset[str] = frozenset()
) -> ComponentFinding:
    """Analyze a single component into a ComponentFinding.

    ``project_classes`` are the class names the project declares in its own
    stylesheets — a project-level fact a single component cannot see, and the
    only way to tell a Tailwind utility from a class NativeWind will ignore.
    """
    issues: list[Issue] = []
    issues += _element_issues(comp)
    issues += _event_issues(comp)
    issues += component_styling_issues(comp, project_classes)
    issues += _web_api_issues(comp)
    issues += _text_wrap_issues(comp)
    issues += _flex_row_issues(comp)
    issues += _image_issues(comp)
    issues += _inline_style_issues(comp)

    score, difficulty = score_component(issues)
    return ComponentFinding(
        componentId=comp.id,
        name=comp.name,
        file=comp.file,
        difficulty=difficulty,
        score=score,
        issues=issues,
    )


def analyze_components(kg: KnowledgeGraph) -> list[ComponentFinding]:
    project_classes = project_defined_classes(kg)
    return [analyze_component(c, project_classes) for c in kg.components]
