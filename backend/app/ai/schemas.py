"""AI Resolution Engine — request/response contract.

The AI Resolution Engine is a **scalpel for the residue**, never the default
path (see ``CLAUDE.md``). Its entire input is one piece of residue at a time —
NEVER a whole file. That principle is enforced *mechanically* here, not merely
documented: constructing a :class:`ResolutionRequest` whose snippet + context
exceeds the line budget raises :class:`SnippetBudgetError`.

This module defines only the contract. No resolver, no LLM call, lives here.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.validation import Diagnostic

# The residue we hand an LLM must be a scalpel-sized slice. If snippet + context
# exceeds this many lines, we are smuggling a whole file into the prompt — a
# violation of Rejox's core principle. Configurable per request; this is the
# default and the value the schema enforces unless overridden.
DEFAULT_MAX_SNIPPET_LINES = 60

Confidence = Literal["high", "medium", "low"]


class SnippetBudgetError(Exception):
    """Raised when a ResolutionRequest's snippet + context is too large.

    Deliberately NOT a ``ValueError`` so it propagates out of pydantic
    validation unchanged (pydantic only wraps ``ValueError``/``AssertionError``),
    giving callers a crisp, catchable failure that names the budget.
    """


def _line_count(*chunks: str) -> int:
    return sum(len(chunk.splitlines()) for chunk in chunks if chunk)


class AIBase(BaseModel):
    """Base model: forbid unknown keys so schema drift is caught loudly."""

    model_config = ConfigDict(extra="forbid")


class ResolutionRequest(AIBase):
    """One unit of residue handed to the AI Resolution Engine.

    ``snippet`` is the residue itself (e.g. a ``hover:`` class, an ``<Outlet />``);
    ``context`` is the *minimal* surrounding code needed to resolve it — never
    the whole file. ``diagnostics`` carries the validator errors this residue
    caused, when it broke the build.
    """

    issueCode: str = Field(..., description="Residue code, e.g. 'CSS_MODULE', 'NAV_CONTAINER'.")
    snippet: str = Field(..., description="The residue to resolve.")
    context: str = Field("", description="Minimal surrounding code — NEVER a whole file.")
    targetOptions: dict[str, Any] = Field(
        default_factory=dict,
        description="Chosen migration targets, e.g. {'stylingEngine': 'nativewind'}.",
    )
    diagnostics: list[Diagnostic] = Field(
        default_factory=list,
        description="Validator diagnostics this residue caused, if it broke the build.",
    )
    maxSnippetLines: int = Field(
        DEFAULT_MAX_SNIPPET_LINES,
        gt=0,
        description="Line budget for snippet + context; over-budget requests are refused.",
    )

    @model_validator(mode="after")
    def _enforce_budget(self) -> "ResolutionRequest":
        total = _line_count(self.snippet, self.context)
        if total > self.maxSnippetLines:
            raise SnippetBudgetError(
                f"ResolutionRequest for {self.issueCode!r} carries {total} lines "
                f"(snippet+context), over the {self.maxSnippetLines}-line budget. "
                "The AI Resolution Engine resolves residue, never whole files — "
                "narrow the context."
            )
        return self


class ResolutionResponse(AIBase):
    """The AI Resolution Engine's answer for one piece of residue."""

    code: str = Field("", description="The replacement snippet (empty if unresolvable).")
    explanation: str = Field("", description="Why this resolution is correct.")
    confidence: Confidence = "medium"
    unresolvable: bool = Field(
        False, description="True when the residue genuinely needs a human decision."
    )
    reason: Optional[str] = Field(
        None, description="Why it is unresolvable (required when unresolvable=True)."
    )

    @model_validator(mode="after")
    def _reason_when_unresolvable(self) -> "ResolutionResponse":
        if self.unresolvable and not (self.reason and self.reason.strip()):
            raise ValueError("unresolvable=True requires a non-empty reason.")
        return self
