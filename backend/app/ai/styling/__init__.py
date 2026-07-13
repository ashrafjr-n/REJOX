"""Styling Resolver — the first real resolver in the AI Resolution Engine.

Resolves the unsupported-Tailwind residue (``TW_UNSUPPORTED``) the Deterministic
Transformer leaves behind, through a **three-tier ladder** — deterministic
first, AI last:

    static_map  →  pattern  →  llm

Only what tiers 1 and 2 genuinely cannot answer reaches the LLM. That ladder is
Rejox's core principle made mechanical (see ``CLAUDE.md``): the lower the LLM
count, the better the design.
"""

from app.ai.styling.models import (
    LadderResult,
    MappedResidue,
    Resolution,
    ResolutionTier,
    confidence_source_for,
)
from app.ai.styling.resolver import StylingResolver, resolve_styling

__all__ = [
    "LadderResult",
    "MappedResidue",
    "Resolution",
    "ResolutionTier",
    "StylingResolver",
    "confidence_source_for",
    "resolve_styling",
]
