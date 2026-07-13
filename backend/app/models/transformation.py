"""Transformation schema — the Deterministic Transformer output.

Produced deterministically by the Node codemod-worker for a single source file.
The ``unhandled`` list is precisely the residue the AI Resolution Engine will
be asked to resolve — everything else was handled by rules.

Keep in sync with ``backend/codemod-worker/src/types.ts``.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class TransformBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TransformWarning(TransformBase):
    code: str
    message: str
    line: int


class UnhandledItem(TransformBase):
    """Something rules could not safely resolve → AI Resolution Engine residue."""

    code: str
    snippet: str


class TransformResult(TransformBase):
    file: str
    code: str
    warnings: list[TransformWarning] = Field(default_factory=list)
    unhandled: list[UnhandledItem] = Field(default_factory=list)
