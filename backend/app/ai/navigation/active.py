"""Tier 1 — NAV_ACTIVE resolved by rule.

A ``NavLink`` styled by ``isActive`` is not a design question: React Navigation
already exposes route-focus state. The mechanical answer is
``useIsFocused()`` — it drives the active branch regardless of navigator shape
(and in a bottom-tab navigator the tab bar styles the active tab for free). No
LLM is needed; this is a known pattern.
"""

from __future__ import annotations

from typing import Any, Optional

from app.ai.navigation.models import NavResolution, NavTier
from app.ai.schemas import ResolutionResponse

NAVIGATION_MODULE = "@react-navigation/native"


def resolve_nav_active(
    snippet: str = "", options: Optional[dict[str, Any]] = None
) -> NavResolution:
    """Resolve an ``isActive`` className/style into React Navigation focus state."""
    code = (
        "const isFocused = useIsFocused();\n"
        "// className/style: isFocused ? <active> : <inactive>"
    )
    return NavResolution(
        issueCode="NAV_ACTIVE",
        tier=NavTier.RULE,
        response=ResolutionResponse(
            code=code,
            explanation=(
                "Active state is navigation state; React Navigation's useIsFocused() "
                "exposes it. In a bottom-tab navigator the active tab is styled "
                "automatically via tabBarActiveTintColor."
            ),
            confidence="high",
        ),
        note=(
            f"import {{ useIsFocused }} from '{NAVIGATION_MODULE}'; replace the "
            "isActive render-prop with the isFocused branch (or delete it and let "
            "the Tab navigator style the active tab)."
        ),
    )
