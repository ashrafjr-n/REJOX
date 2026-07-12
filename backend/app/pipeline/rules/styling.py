"""Styling rules.

Classifies Tailwind utility classes against what NativeWind can reasonably map,
producing per-component styling issues and the project-level styling report.
Pure functions over KG facts (``component.tailwindClasses`` / ``stylingApproach``
/ ``cssModuleImports``).
"""

from __future__ import annotations

from app.models.analysis import Evidence, Issue, StylingReport
from app.models.knowledge_graph import Component, KnowledgeGraph

from . import codes

RESPONSIVE_PREFIXES = ("sm:", "md:", "lg:", "xl:", "2xl:")

_GRID_PREFIXES = (
    "grid-cols",
    "grid-rows",
    "col-span",
    "row-span",
    "col-start",
    "col-end",
    "row-start",
    "row-end",
    "auto-cols",
    "auto-rows",
)
_GRADIENT_PREFIXES = ("from-", "via-", "to-", "bg-gradient")

# Categories that NativeWind cannot map cleanly → surfaced as unmappable.
UNMAPPABLE_CATEGORIES = frozenset({"hover", "grid", "group", "gradient"})


def classify_class(cls: str) -> set[str]:
    """Return the set of problem categories a Tailwind class belongs to.

    An empty set means the class is expected to map fine under NativeWind.
    A class can be in more than one category (e.g. ``sm:grid-cols-2`` is both
    ``responsive`` and ``grid``).
    """
    cats: set[str] = set()
    base = cls
    for prefix in RESPONSIVE_PREFIXES:
        if base.startswith(prefix):
            cats.add("responsive")
            base = base[len(prefix):]
            break

    if base.startswith("hover:"):
        cats.add("hover")
    elif base.startswith(("focus:", "focus-visible:", "active:")):
        cats.add("interaction")
    elif base == "group" or base.startswith("group-"):
        cats.add("group")
    elif base == "grid" or base.startswith(_GRID_PREFIXES):
        cats.add("grid")
    elif base.startswith(_GRADIENT_PREFIXES):
        cats.add("gradient")
    return cats


# category → (issue code, severity, human message)
_CATEGORY_ISSUE = {
    "hover": (codes.HOVER_STATE, "warning", "Hover utilities have no touch equivalent; map to Pressable state."),
    "grid": (codes.CSS_GRID, "warning", "CSS grid is unavailable in RN; reflow to flexbox (flex-wrap)."),
    "group": (codes.GROUP_SELECTOR, "warning", "group/group-hover selectors have no RN equivalent."),
    "gradient": (codes.GRADIENT, "info", "Gradients need expo-linear-gradient in RN."),
    "responsive": (codes.RESPONSIVE_BREAKPOINT, "info", "Responsive breakpoints need NativeWind config / useWindowDimensions."),
    "interaction": (codes.INTERACTION_STATE, "info", "focus/active states are only partially supported in RN."),
}

# Dependencies whose presence implies runtime-computed class names.
DYNAMIC_CLASSNAME_LIBS = frozenset(
    {"clsx", "classnames", "cva", "class-variance-authority", "tailwind-merge"}
)


def component_styling_issues(comp: Component) -> list[Issue]:
    """Emit styling issues for a single component from its KG facts."""
    issues: list[Issue] = []

    # Bucket every class by category, keeping the offending classes as evidence.
    by_category: dict[str, list[str]] = {}
    for cls in comp.tailwindClasses:
        for cat in classify_class(cls):
            by_category.setdefault(cat, []).append(cls)

    for cat, (code, severity, message) in _CATEGORY_ISSUE.items():
        hits = by_category.get(cat)
        if not hits:
            continue
        issues.append(
            Issue(
                code=code,
                severity=severity,  # type: ignore[arg-type]
                message=message,
                evidence=Evidence(
                    file=comp.file, detail=f"classes: {', '.join(sorted(set(hits)))}"
                ),
            )
        )

    # CSS Modules → manual conversion.
    if comp.cssModuleImports:
        issues.append(
            Issue(
                code=codes.CSS_MODULE,
                severity="warning",
                message="CSS Module must be hand-converted to a StyleSheet / NativeWind.",
                evidence=Evidence(
                    file=comp.file,
                    detail=f"imports: {', '.join(comp.cssModuleImports)}",
                ),
            )
        )

    # Dynamic className: flagged tailwind but no static classes were resolvable.
    if "tailwind" in comp.stylingApproach and not comp.tailwindClasses:
        issues.append(
            Issue(
                code=codes.DYNAMIC_CLASSNAME,
                severity="warning",
                message="className is computed at runtime; classes can't be statically mapped.",
                evidence=Evidence(
                    file=comp.file, detail="stylingApproach=tailwind, 0 static classes"
                ),
            )
        )

    return issues


def analyze_styling(kg: KnowledgeGraph) -> StylingReport:
    """Build the project-level styling report."""
    approaches: set[str] = set()
    all_classes: set[str] = set()
    unmappable: set[str] = set()
    css_modules: set[str] = set()

    for comp in kg.components:
        for approach in comp.stylingApproach:
            if approach != "none":
                approaches.add(approach)
        for cls in comp.tailwindClasses:
            all_classes.add(cls)
            if classify_class(cls) & UNMAPPABLE_CATEGORIES:
                unmappable.add(cls)
        for mod in comp.cssModuleImports:
            css_modules.add(mod)

    return StylingReport(
        approaches=sorted(approaches),
        tailwindClassCount=len(all_classes),
        unmappableClasses=sorted(unmappable),
        cssModuleCount=len(css_modules),
    )
