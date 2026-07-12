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
from .styling import component_styling_issues

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


def analyze_component(comp: Component) -> ComponentFinding:
    """Analyze a single component into a ComponentFinding."""
    issues: list[Issue] = []
    issues += _element_issues(comp)
    issues += _event_issues(comp)
    issues += component_styling_issues(comp)
    issues += _web_api_issues(comp)

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
    return [analyze_component(c) for c in kg.components]
