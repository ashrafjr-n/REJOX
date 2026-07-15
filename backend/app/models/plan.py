"""Migration Plan schema — the Planner stage output.

Produced deterministically from an :class:`AnalysisReport` (+ the Knowledge
Graph). The Planner transforms findings into an ordered plan and the questions
the Ask stage will put to the user. No LLM, no conversion happens here.

Keep in sync with ``app/pipeline/planner.py``.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.analysis import AnalysisReport, Severity

StepKind = Literal[
    "setup", "routing", "components", "styling", "state", "api",
    "assets", "navigation", "validation",
]
Effort = Literal["small", "medium", "large"]


class PlanBase(BaseModel):
    """Base model: forbid unknown keys so schema drift is caught loudly."""

    model_config = ConfigDict(extra="forbid")


# --- Questions (Ask stage) --------------------------------------------------


class QuestionOption(PlanBase):
    id: str
    label: str
    description: str
    tradeoffs: str
    isRecommended: bool = False


class QuestionDependency(PlanBase):
    """This question only matters once `optionId` is chosen for `questionId`."""

    questionId: str
    optionId: str


class Question(PlanBase):
    id: str
    title: str
    context: str
    options: list[QuestionOption] = Field(default_factory=list)
    required: bool = True
    dependsOn: Optional[QuestionDependency] = None


# --- Plan steps -------------------------------------------------------------


class StepFinding(PlanBase):
    """An issue/TODO that pertains to one of a step's targets.

    Associated by the Planner over real KG ids (matched by source file), so a
    finding attaches to *every* step that touches the file — not only the
    component-conversion waves. ``componentId`` is the KG id it came from.
    """

    componentId: str
    code: str
    severity: Severity
    message: str


class PlanStep(PlanBase):
    id: str
    order: int
    # Topological wave (0-based) — the step's longest-path layer over
    # ``dependsOn``. The Planner's own concept (leaves = 0), stated here so the
    # UI never has to recompute it. Distinct from ``order`` (the linear sequence).
    wave: int = 0
    title: str
    description: str
    kind: StepKind
    targets: list[str] = Field(default_factory=list)
    estimatedEffort: Effort
    dependsOn: list[str] = Field(default_factory=list)
    affectedByQuestions: list[str] = Field(default_factory=list)
    # Issues/TODOs on this step's targets (empty when the step is clean).
    findings: list[StepFinding] = Field(default_factory=list)
    notes: Optional[str] = None


# --- Review + unsupported ---------------------------------------------------


class ManualReviewCandidate(PlanBase):
    componentId: str
    reason: str


class UnsupportedItem(PlanBase):
    name: str
    reason: str
    suggestion: str


# --- Root -------------------------------------------------------------------


class MigrationPlan(PlanBase):
    projectName: str
    questions: list[Question] = Field(default_factory=list)
    steps: list[PlanStep] = Field(default_factory=list)
    manualReviewCandidates: list[ManualReviewCandidate] = Field(default_factory=list)
    unsupportedItems: list[UnsupportedItem] = Field(default_factory=list)


class PlanResponse(PlanBase):
    """Combined payload for the API — the frontend needs both together."""

    report: AnalysisReport
    plan: MigrationPlan
