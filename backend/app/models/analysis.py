"""Analysis schema — the Migration Report data model.

Produced by the Analyzer stage as pure, deterministic functions over the
Knowledge Graph. Every field is traceable to a KG fact; no LLM is involved.

Keep in sync with ``app/pipeline/analyzer.py`` and its ``rules`` submodule.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.knowledge_graph import RouteElementProp, RouteHostState

# --- Shared enums -----------------------------------------------------------

Severity = Literal["info", "warning", "blocker"]

LibraryCategory = Literal[
    "routing", "state", "http", "styling", "animation", "ui", "build", "other"
]
LibraryStatus = Literal[
    "compatible", "needs-conversion", "partial", "unsupported", "unknown"
]
Difficulty = Literal["trivial", "easy", "medium", "hard", "blocked"]

RiskLevel = Literal["low", "medium", "high"]


class ConfidenceSource(str, Enum):
    """Provenance of a migrated unit — Confidence is COMPUTED from this, never
    estimated. The AI values are reserved so the AI Resolution Engine plugs in
    without schema churn.
    """

    DETERMINISTIC = "deterministic"                    # rule, no warning
    DETERMINISTIC_WARNING = "deterministic-warning"    # rule + warning
    AI_VALIDATED = "ai-validated"                      # AI-resolved, validator passed
    AI_FAILED = "ai-failed"                            # AI-resolved, validator failed
    UNHANDLED = "unhandled"                            # residue — excluded from Confidence


# Confidence value per provenance. ``None`` = excluded from Confidence — the
# unit counts against Coverage instead (it was not migrated).
CONFIDENCE_BY_SOURCE: dict[ConfidenceSource, Optional[int]] = {
    ConfidenceSource.DETERMINISTIC: 100,
    ConfidenceSource.DETERMINISTIC_WARNING: 80,
    ConfidenceSource.AI_VALIDATED: 65,
    ConfidenceSource.AI_FAILED: 0,
    ConfidenceSource.UNHANDLED: None,
}


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
    # Props the react-router element passed, which a `Screen component={…}`
    # cannot carry, plus the routing component's own state — together they let
    # the generator hoist rather than drop. See NAV_SCREEN_PROPS.
    elementProps: list[RouteElementProp] = Field(default_factory=list)
    hostState: list[RouteHostState] = Field(default_factory=list)


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


# --- Domains ----------------------------------------------------------------


class DomainRisk(AnalysisBase):
    """A functional domain detected in the project (evidence-based, from KG
    facts only — a domain with no signal is simply absent, never "unknown")."""

    domain: str
    risk: RiskLevel
    reason: str
    rnNotes: str
    evidence: list[Evidence] = Field(default_factory=list)


# --- Summary + scores ---------------------------------------------------------


class Summary(AnalysisBase):
    componentCount: int
    pageCount: int
    routeCount: int
    apiEndpointCount: int
    storeCount: int


class ScoreContribution(AnalysisBase):
    """One explainable, signed step of the Coverage figure.

    The contract: ``sum(c.delta for c in contributions) == coverage`` (base 0;
    positive rows grant an area's budget, negative rows subtract deductions).
    """

    label: str
    delta: float
    reason: str
    evidence: str


# --- Root -------------------------------------------------------------------


class AnalysisReport(AnalysisBase):
    projectName: str
    summary: Summary
    libraries: list[LibraryFinding] = Field(default_factory=list)
    components: list[ComponentFinding] = Field(default_factory=list)
    routing: RoutingReport
    styling: StylingReport
    domains: list[DomainRisk] = Field(default_factory=list)
    blockers: list[Issue] = Field(default_factory=list)
    warnings: list[Issue] = Field(default_factory=list)
    # --- The three independent axes (never conflated) ---
    # Coverage: how much of the project can be / was migrated.
    coverage: float = Field(ge=0, le=100)
    # Confidence: how sure we are that what WAS migrated is correct —
    # computed from provenance (ConfidenceSource), never estimated.
    # None when NOTHING migrates (every component blocked): the question has no
    # answer over an empty population, and an empty mean must not fall back to
    # 100. Coverage still carries the shortfall; this renders as "n/a".
    confidence: Optional[float] = Field(default=None, ge=0, le=100)
    # Risk: worst detected functional-domain risk ("low" when none detected).
    risk: RiskLevel
    # Explainable breakdown; deltas sum exactly to `coverage`.
    contributions: list[ScoreContribution] = Field(default_factory=list)
