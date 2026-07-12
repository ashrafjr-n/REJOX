"""Conversion schema — the codemod (Converter Part 1) output.

Produced deterministically by the Node codemod-worker for a single source file.
The ``unhandled`` list is precisely what Part 2 (LLM-assisted) will resolve.

Keep in sync with ``backend/codemod-worker/src/types.ts``.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ConversionBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConversionWarning(ConversionBase):
    code: str
    message: str
    line: int


class UnhandledItem(ConversionBase):
    """Something the deterministic codemod could not safely resolve → Part 2."""

    code: str
    snippet: str


class ConversionResult(ConversionBase):
    file: str
    code: str
    warnings: list[ConversionWarning] = Field(default_factory=list)
    unhandled: list[UnhandledItem] = Field(default_factory=list)
