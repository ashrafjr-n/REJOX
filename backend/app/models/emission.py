"""Emission schema — the full-project output of the Migration Engine.

Produced by ``app/pipeline/emit.py``: the Deterministic Transformer applied to
every file of the source project, assembled into a runnable React Native tree
(scaffold + ported files + generated navigator). Every emitted file carries its
provenance (:class:`ConfidenceSource`) so the Validator can wire Confidence to
validated reality instead of a static-analysis prediction.

Keep in sync with ``app/pipeline/emit.py``.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models.analysis import ConfidenceSource
from app.models.transformation import TransformWarning, UnhandledItem


class EmissionBase(BaseModel):
    """Base model: forbid unknown keys so schema drift is caught loudly."""

    model_config = ConfigDict(extra="forbid")


class EmittedFile(EmissionBase):
    """One file written into the React Native output tree.

    ``provenance`` is derived from what actually happened to the file:

    - ``deterministic``          — transformed by rules, no warnings, no residue.
    - ``deterministic-warning``  — transformed by rules but flagged (warnings)
      and/or generated (scaffold, navigator).
    - ``unhandled``              — carries ``unhandled`` residue that only the AI
      Resolution Engine can resolve; excluded from Confidence.
    """

    path: str                        # path relative to the output root
    sourceFile: str | None = None    # source path this came from (None = generated)
    provenance: ConfidenceSource
    warnings: list[TransformWarning] = Field(default_factory=list)
    unhandled: list[UnhandledItem] = Field(default_factory=list)
    # REJOX-TODO(<CODE>) codes present in this file's emitted text — the anchors
    # the Validator maps diagnostics back to.
    todoCodes: list[str] = Field(default_factory=list)


class SkippedFile(EmissionBase):
    """A source file deliberately not emitted, with the reason why."""

    path: str
    reason: str


class EmittedProject(EmissionBase):
    """The assembled React Native project + per-file provenance."""

    outDir: str
    files: list[EmittedFile] = Field(default_factory=list)
    skipped: list[SkippedFile] = Field(default_factory=list)
    # Total REJOX-TODO items across every emitted file (residue count).
    todoCount: int = 0
