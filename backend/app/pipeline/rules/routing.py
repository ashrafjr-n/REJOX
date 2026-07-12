"""Routing rules.

Maps react-router routes to a proposed React Navigation stack and surfaces the
worker's object-config-router warning as an OBJECT_ROUTER_UNPARSED issue.
"""

from __future__ import annotations

from app.models.analysis import Evidence, Issue, RouteMapping, RoutingReport
from app.models.knowledge_graph import KnowledgeGraph

from . import codes

_ROUTER_DEPS = ("react-router-dom", "react-router")


def _screen_name(componentName: str | None, path: str | None) -> str:
    """Derive a React Navigation screen name."""
    if componentName:
        # Strip a trailing "Page" for a cleaner screen name (HomePage → Home).
        return componentName[:-4] if componentName.endswith("Page") else componentName
    if path in (None, "/", ""):
        return "Home"
    return "".join(part.capitalize() for part in path.strip("/").split("/") if not part.startswith(":")) or "Screen"


def analyze_routing(kg: KnowledgeGraph) -> RoutingReport:
    router_lib = next(
        (dep for dep in _ROUTER_DEPS if dep in kg.project.dependencies), None
    )

    mappings = [
        RouteMapping(
            screenName=_screen_name(r.componentName, r.path),
            componentName=r.componentName,
            path=r.path,
            params=r.params,
            hasParams=r.hasParams,
        )
        for r in kg.routes
    ]

    warnings: list[Issue] = []
    if router_lib:
        warnings.append(
            Issue(
                code=codes.ROUTER_NEEDS_CONVERSION,
                severity="warning",
                message=(
                    f"{router_lib} must be migrated to React Navigation "
                    f"({len(mappings)} route(s))."
                ),
                evidence=Evidence(file="package.json", detail=f"dependency: {router_lib}"),
            )
        )

    # Surface the worker's object-config-router warning, if any.
    for w in kg.warnings:
        if "createBrowserRouter" in w or "createHashRouter" in w or "Object-config router" in w:
            warnings.append(
                Issue(
                    code=codes.OBJECT_ROUTER_UNPARSED,
                    severity="blocker",
                    message="Object-config router was not parsed; routes may be incomplete.",
                    evidence=Evidence(file=None, detail=w),
                )
            )

    return RoutingReport(
        library=router_lib,
        routes=mappings,
        hasParams=any(r.hasParams for r in kg.routes),
        warnings=warnings,
    )
