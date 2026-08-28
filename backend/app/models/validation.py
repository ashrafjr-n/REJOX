"""Validation schema — the Validator stage output.

The Validator is the Migration Engine's judge: it runs REAL tools (``tsc`` and
the Metro bundler) against the emitted React Native project and parses their
output into structured, machine-readable diagnostics. Those diagnostics — mapped
back to the transform that produced them (:class:`MappedDiagnostic`) — are the
exact payload the AI Resolution Engine will later consume as its repair loop.

Keep in sync with ``app/pipeline/validator.py``.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.analysis import ConfidenceSource
from app.models.transformation import UnhandledItem

DiagnosticSeverity = Literal["error", "warning"]
DiagnosticSource = Literal["typecheck", "bundle", "lint"]


class ValidationBase(BaseModel):
    """Base model: forbid unknown keys so schema drift is caught loudly."""

    model_config = ConfigDict(extra="forbid")


class Diagnostic(ValidationBase):
    """One structured tool diagnostic — parsed, never a raw text blob."""

    source: DiagnosticSource
    file: Optional[str] = None       # path relative to the output root, if known
    line: Optional[int] = None
    column: Optional[int] = None
    code: Optional[str] = None       # e.g. "TS2304"
    severity: DiagnosticSeverity = "error"
    message: str


class StageResult(ValidationBase):
    """The outcome of one validation stage (typecheck / bundle / lint)."""

    ran: bool = False                # False when skipped (e.g. install skipped)
    passed: bool = False
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    errorCount: int = 0
    skippedReason: Optional[str] = None
    rawTail: Optional[str] = None    # last lines of tool output, for debugging


class ValidationResult(ValidationBase):
    """The full verdict on an emitted project."""

    passed: bool = False
    installed: bool = False
    typecheck: StageResult
    bundle: StageResult
    lint: Optional[StageResult] = None
    durationSeconds: float = 0.0
    toolVersions: dict[str, str] = Field(default_factory=dict)


# --- Diagnostic → source mapping (the AI Resolution Engine's contract) --------


class MappedDiagnostic(ValidationBase):
    """A diagnostic tied back to the transform that produced it.

    This is the exact payload the AI Resolution Engine will receive. A raw
    ``tsc`` error is useless to a repair loop unless we know which file, which
    transform provenance, and which residue (REJOX-TODO) it belongs to.
    """

    diagnostic: Diagnostic
    file: Optional[str] = None                 # output-relative file path
    sourceComponent: Optional[str] = None      # originating source file, if resolvable
    provenance: Optional[ConfidenceSource] = None
    # REJOX-TODO codes on or near the offending line — if present, the error is
    # legitimate residue (belongs to the AI Resolution Engine), not a codemod bug.
    nearbyTodo: list[str] = Field(default_factory=list)
    # The offending emitted lines, with a few lines of context.
    sourceSnippet: Optional[str] = None
    # The corresponding React source lines, if resolvable.
    originalSnippet: Optional[str] = None
    # The unhandled residue item this maps to, when the file recorded one.
    residue: Optional[UnhandledItem] = None


# --- Confidence wired to validated reality -----------------------------------


class ValidatedScores(ValidationBase):
    """Coverage / Confidence recomputed from the EMITTED + VALIDATED project,
    not from the Analyzer's static-analysis prediction.

    Confidence is provenance-driven, exactly as the Analyzer defines it, but now
    keyed to what actually happened: a file is worth 100 when it was produced
    deterministically and the validator passed on it, 80 when it carried a
    deterministic warning, and is EXCLUDED (residue) when it still has an
    unresolved REJOX-TODO — that file counts against Coverage instead.
    """

    # Every score below is None when there was nothing to measure
    # (``totalUnitCount == 0``). A migration that emitted no units has no
    # coverage of 100% — it has no coverage at all, and an empty population must
    # never round up into a perfect score. Callers render None as "n/a".
    #
    # Strict, spec-literal Coverage: fraction of units with ZERO residue
    # (any unresolved REJOX-TODO counts against it). Comparable to Confidence's
    # population; conservative because a single `hover:` utility excludes a file.
    # This is the HEADLINE number — the one Rejox leads with.
    coverage: Optional[float] = Field(default=None, ge=0, le=100)
    confidence: Optional[float] = Field(default=None, ge=0, le=100)
    # A second, more forgiving lens: fraction of units that actually COMPILE +
    # BUNDLE. Soft residue (hover/grid/gradient) does not stop a file from
    # working, so this is the number directly comparable to the Analyzer's
    # area-weighted Coverage prediction. Always reported ALONGSIDE the strict
    # figure, never instead of it.
    workingCoverage: Optional[float] = Field(default=None, ge=0, le=100)
    workingFileCount: int = 0       # units with no tsc/bundle error
    migratedFileCount: int          # units that migrated cleanly (no residue)
    residueFileCount: int           # units excluded from Confidence (residue)
    totalUnitCount: int
    validatorPassed: bool
    # Files that validated clean but were deterministic — the 100s.
    cleanDeterministic: int = 0
    cleanWithWarning: int = 0
    # A supposedly-migrated file that FAILED validation = a codemod bug (0).
    failedUnits: list[str] = Field(default_factory=list)
    # The Analyzer's prediction, for the credibility delta.
    predictedCoverage: Optional[float] = None
    predictedConfidence: Optional[float] = None
