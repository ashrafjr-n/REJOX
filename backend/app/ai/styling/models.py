"""Styling Resolver — request/response contract and tier taxonomy.

The Deterministic Transformer emits one ``UnhandledItem`` per file for
unsupported Tailwind: ``code="TW_UNSUPPORTED"``, ``snippet`` = the space-joined,
sorted list of classes that have no NativeWind mapping (see
``codemod-worker/src/transforms/styles.ts``). A :class:`MappedResidue` wraps
that item with the minimal context the resolver needs.

Every :class:`Resolution` records the **tier** that produced it. That tier is
the honest provenance of the answer and is what drives Confidence downstream:
tiers 1–2 are deterministic rules; tier 3 is the LLM scalpel.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from app.ai.schemas import AIBase, ResolutionResponse
from app.models.analysis import ConfidenceSource


class ResolutionTier(str, Enum):
    """Which rung of the ladder resolved a piece of residue.

    Order matters: resolution is attempted top-to-bottom and stops at the first
    tier that can answer. ``LLM`` is the last resort, never the default.
    """

    STATIC_MAP = "static_map"  # declarative, fixed RN equivalent — no reasoning
    PATTERN = "pattern"        # deterministic structural transform (parametric)
    LLM = "llm"                # genuine reasoning — the residue of the residue


class MappedResidue(AIBase):
    """One file's unsupported-Tailwind residue, ready for the Styling Resolver.

    ``snippet`` is the transformer's ``UnhandledItem.snippet`` — a space-joined,
    sorted bag of classes with no NativeWind mapping (e.g.
    ``"bg-gradient-to-br from-indigo-600 to-violet-600"``). The resolver
    partitions that bag into resolvable units and runs each through the ladder.
    """

    issueCode: str = "TW_UNSUPPORTED"
    snippet: str
    componentName: Optional[str] = None
    sourceFile: Optional[str] = None
    # Minimal surrounding JSX, when the caller has it. Never a whole file — the
    # ladder is deterministic-first and rarely needs it.
    context: str = ""

    @property
    def classes(self) -> list[str]:
        """The individual class tokens in this residue's bag."""
        return [c for c in self.snippet.split() if c]


class Resolution(AIBase):
    """The Styling Resolver's answer for ONE resolvable unit of residue.

    A single file's residue typically yields several resolutions (one per unit
    — the gradient, the grid, each ``hover:`` class …), each stamped with the
    tier that produced it so the tier distribution is auditable.
    """

    issueCode: str = "TW_UNSUPPORTED"
    # The class(es) this resolution addresses — one token, or a space-joined
    # group (a gradient's ``bg-gradient-* from-* to-*``, a grid's classes).
    snippet: str
    tier: ResolutionTier
    response: ResolutionResponse
    # Side-effects the emit pipeline must apply alongside ``response.code`` —
    # e.g. an import to add, or a style to push onto children. Advisory text.
    note: str = ""
    componentName: Optional[str] = None
    sourceFile: Optional[str] = None


@dataclass
class LadderResult:
    """Internal: what a single tier returns when it CAN resolve a unit.

    ``None`` from a tier means "I can't answer — fall through to the next rung".
    The orchestrator wraps this into a :class:`Resolution` with the residue's
    file/component metadata attached.
    """

    tier: ResolutionTier
    response: ResolutionResponse
    note: str = ""


def confidence_source_for(resolution: Resolution) -> ConfidenceSource:
    """Map a resolution's tier to the Confidence provenance it implies.

    Deterministic tiers (static_map, pattern) re-express residue by rule, so
    they carry ``deterministic-warning`` — safe, but a re-expression a human may
    want to eyeball. The LLM tier is only ``ai-validated`` once the Validator
    proves it; until then the emit/repair loop owns that transition. Unresolvable
    residue stays ``unhandled`` (excluded from Confidence, counts against
    Coverage). This is not yet wired into emit — it defines the contract.
    """
    if resolution.response.unresolvable:
        return ConfidenceSource.UNHANDLED
    if resolution.tier in (ResolutionTier.STATIC_MAP, ResolutionTier.PATTERN):
        return ConfidenceSource.DETERMINISTIC_WARNING
    return ConfidenceSource.AI_VALIDATED
