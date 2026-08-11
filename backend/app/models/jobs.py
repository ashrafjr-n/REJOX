"""Job + event schemas — the async Migration Engine.

``POST /api/migrate`` no longer blocks for minutes (emit → npm install → tsc →
Metro). It creates a **job** that runs in the background and streams **events**
as real pipeline boundaries are crossed. Every model here lands in
``/openapi.json`` so the frontend generates its types from them.

Design rules (enforced by the orchestrator, not this schema):
- Every event corresponds to something that ACTUALLY happened, emitted when it
  happened. No time estimates, no percent-complete, no synthetic ticks.
- A stage is only marked ``stage_completed`` once it truly completed; its
  payload carries REAL counts the engine observed (files, diagnostics, LLM
  calls, repair round N of M).
- The terminal event carries the full :class:`MigrationResult` on success or a
  structured :class:`MigrationError` on failure; the stream closes after it.
- ``GET /api/jobs/{id}`` reconstructs the whole picture from job state alone —
  the stream is a convenience, never the source of truth.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.analysis import AnalysisReport
from app.models.emission import EmittedProject
from app.models.plan import MigrationPlan
from app.models.validation import (
    MappedDiagnostic,
    ValidatedScores,
    ValidationResult,
)

JobStatus = Literal["queued", "running", "succeeded", "failed"]

# The pipeline's real, ordered boundaries — instrumented, never invented.
#
# The first three run *before* the Migration Engine: a job rebuilds the graph,
# analyzes and plans before it can emit anything. They exist so a failure there
# is reported where it happened (they are not instrumented with
# started/completed events — nothing observable happens between them, and the
# Migration Engine's own stages start at ``emit``).
MigrationStage = Literal[
    "intelligence",  # build the Knowledge Graph (parser-worker)
    "analyze",       # analyze the graph into a report
    "plan",          # turn the report into an ordered migration plan
    "emit",       # transform + assemble the RN project (incl. the 1 nav-shape decision)
    "install",    # npm install in the emitted project
    "typecheck",  # tsc --noEmit
    "bundle",     # Metro export (expo export)
    "repair",     # one LLM repair round over residue errors
    "done",       # terminal
]

MigrationEventType = Literal[
    "stage_started",    # a stage began (no counts yet)
    "stage_completed",  # a stage finished — payload carries what actually happened
    "succeeded",        # terminal: carries the MigrationResult
    "failed",           # terminal: carries the MigrationError
]


class JobBase(BaseModel):
    """Base model: forbid unknown keys so schema drift is caught loudly."""

    model_config = ConfigDict(extra="forbid")


class MigrationEventData(JobBase):
    """Observed counts for one event. Every field is OPTIONAL: only the numbers
    the engine actually measured at this boundary are populated; an unset field
    means "not applicable to this event", never a guess.
    """

    # emit
    filesEmitted: Optional[int] = None       # total files written into the RN tree
    filesConverted: Optional[int] = None     # files with a source (ported/generated)
    filesSkipped: Optional[int] = None       # source files deliberately not emitted
    todoCount: Optional[int] = None          # residue TODOs left after rule resolution
    navigatorShape: Optional[str] = None     # the chosen navigator shape (tabs/stack/…)

    # install
    installed: Optional[bool] = None
    installSkipped: Optional[bool] = None

    # typecheck / bundle
    ran: Optional[bool] = None
    passed: Optional[bool] = None
    errorCount: Optional[int] = None
    diagnosticsFound: Optional[int] = None
    skippedReason: Optional[str] = None

    # repair
    repairRound: Optional[int] = None
    maxRepairRounds: Optional[int] = None
    repairAttempts: Optional[int] = None

    # shared
    llmCalls: Optional[int] = None           # cumulative real LLM calls so far
    durationSeconds: Optional[float] = None


class MigrationError(JobBase):
    """A structured failure — what broke, and where."""

    type: str
    message: str
    stage: Optional[MigrationStage] = None


class MigrationResult(JobBase):
    """The terminal success payload — the full, reconstructable picture.

    Carries the validated scores and tool verdicts (the numbers the instrument
    reports) plus the complete emission/validation/diagnostics so a late joiner
    reconstructs everything from ``GET /api/jobs/{id}`` alone.
    """

    runId: Optional[str] = None
    # Tool verdicts — observed, not derived.
    validationPassed: bool
    typecheckPassed: bool
    bundlePassed: bool
    bundleRan: bool
    # Run-level counters — observed.
    llmCalls: int
    repairRounds: int
    filesConverted: int
    todoCount: int
    navigatorShape: Optional[str] = None
    durationSeconds: float
    # Validated Coverage/Confidence (recomputed from the emitted + validated tree).
    validatedScores: Optional[ValidatedScores] = None
    # The full picture (superset of the old sync MigrateResponse).
    report: AnalysisReport
    plan: MigrationPlan
    emission: EmittedProject
    validation: ValidationResult
    mappedDiagnostics: list[MappedDiagnostic] = Field(default_factory=list)


class MigrationEvent(JobBase):
    """One entry in the job's event log / SSE stream.

    ``seq`` is a strictly increasing id (1-based) — also the SSE event id, so a
    reconnect with ``Last-Event-ID`` resumes with nothing lost. ``ts`` is the
    real wall-clock epoch-seconds when the event was emitted.
    """

    seq: int
    type: MigrationEventType
    stage: MigrationStage
    ts: float
    message: str
    data: Optional[MigrationEventData] = None
    result: Optional[MigrationResult] = None
    error: Optional[MigrationError] = None


class JobState(JobBase):
    """The full state of a migration job — the source of truth.

    Returned verbatim by ``GET /api/jobs/{id}``: a late joiner or a reconnecting
    client reconstructs the entire run from this alone.
    """

    jobId: str
    runId: Optional[str] = None
    status: JobStatus
    createdAt: float
    updatedAt: float
    events: list[MigrationEvent] = Field(default_factory=list)
    result: Optional[MigrationResult] = None
    error: Optional[MigrationError] = None


class JobCreated(JobBase):
    """The immediate ``202`` body from ``POST /api/migrate``."""

    jobId: str
    status: JobStatus
