"""Analysis schema — the Migration Report data model.

Produced by the Analyzer stage as pure, deterministic functions over the
Knowledge Graph. Every field is traceable to a KG fact; no LLM is involved.

Keep in sync with ``app/pipeline/analyzer.py`` and its ``rules`` submodule.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# --- Shared enums -----------------------------------------------------------

Severity = Literal["info", "warning", "blocker"]

LibraryCategory = Literal[
    "routing", "state", "http", "styling", "animation", "ui", "build", "other"
]
LibraryStatus = Literal[
    "compatible", "needs-conversion", "partial", "unsupported", "unknown"
]
Difficulty = Literal["trivial", "easy", "medium", "hard", "blocked"]


class AnalysisBase(BaseModel):
    """Base model: forbid unknown keys so schema drift is caught loudly."""

    model_config = ConfigDict(extra="forbid")


# --- Issues -----------------------------------------------------------------


class Evidence(AnalysisBase):
    """The KG fact that triggered an issue."""

    file: Optional[str] = None
    detail: str


class Issue(AnalysisBase):
    """A single finding, always tied to evidence."""

    code: str
    severity: Severity
    message: str
    evidence: Evidence


# --- Libraries --------------------------------------------------------------


class RnEquivalent(AnalysisBase):
    name: str
    note: str = ""


class LibraryFinding(AnalysisBase):
    name: str
    version: Optional[str] = None
    category: LibraryCategory
    status: LibraryStatus
    compatibility: int = Field(ge=0, le=100)
    rnEquivalents: list[RnEquivalent] = Field(default_factory=list)
    notes: Optional[str] = None


# --- Components --------------------------------------------------------------


class ComponentFinding(AnalysisBase):
    componentId: str
    name: str
    file: str
    difficulty: Difficulty
    score: int = Field(ge=0, le=100)
    issues: list[Issue] = Field(default_factory=list)


# --- Routing ----------------------------------------------------------------


class RouteMapping(AnalysisBase):
    """A proposed React Navigation screen for a react-router route."""

    screenName: str
    componentName: Optional[str] = None
    path: Optional[str] = None
    params: list[str] = Field(default_factory=list)
    hasParams: bool = False


class RoutingReport(AnalysisBase):
    library: Optional[str] = None
    routes: list[RouteMapping] = Field(default_factory=list)
    hasParams: bool = False
    warnings: list[Issue] = Field(default_factory=list)


# --- Styling ----------------------------------------------------------------


class StylingReport(AnalysisBase):
    approaches: list[str] = Field(default_factory=list)
    tailwindClassCount: int = 0
    unmappableClasses: list[str] = Field(default_factory=list)
    cssModuleCount: int = 0


# --- Summary + score --------------------------------------------------------


class Summary(AnalysisBase):
    componentCount: int
    pageCount: int
    routeCount: int
    apiEndpointCount: int
    storeCount: int


class SubScore(AnalysisBase):
    """A weighted component of the migration score (0-100 with its weight)."""

    score: float = Field(ge=0, le=100)
    weight: float = Field(ge=0, le=1)


class ScoreBreakdown(AnalysisBase):
    components: SubScore
    libraries: SubScore
    styling: SubScore
    routing: SubScore
    api: SubScore

    def weighted_total(self) -> float:
        """Weighted sum of sub-scores → the overall migration score."""
        parts = (
            self.components,
            self.libraries,
            self.styling,
            self.routing,
            self.api,
        )
        return sum(p.score * p.weight for p in parts)

    def weight_sum(self) -> float:
        parts = (
            self.components,
            self.libraries,
            self.styling,
            self.routing,
            self.api,
        )
        return sum(p.weight for p in parts)


# --- Root -------------------------------------------------------------------


class AnalysisReport(AnalysisBase):
    projectName: str
    summary: Summary
    libraries: list[LibraryFinding] = Field(default_factory=list)
    components: list[ComponentFinding] = Field(default_factory=list)
    routing: RoutingReport
    styling: StylingReport
    blockers: list[Issue] = Field(default_factory=list)
    warnings: list[Issue] = Field(default_factory=list)
    migrationScore: float = Field(ge=0, le=100)
    scoreBreakdown: ScoreBreakdown
