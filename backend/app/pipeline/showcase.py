"""Showcase export — freeze one real sample-app pipeline run into a committed
JSON the marketing site reads.

The whole point: the home page must display numbers our own engine actually
produced, never invented demo data. So this module is deliberately a **pure
serializer** — it performs no migration logic of its own. The RUN happens in the
CLI (``rejox export-showcase``), reusing the exact pipeline functions ``rejox
migrate`` uses; here we only *map* the produced artifacts into a lean,
contract-checked shape a visualization can render.

Every field traces to something the engine produced. Nothing is synthesized: if
a value cannot be sourced from a real artifact, the field is omitted rather than
approximated. The shape is a pydantic model so it is contract-checked (not
ad-hoc dict building), and its JSON Schema is emitted alongside the data so the
frontend type is generated from it — never hand-written.
"""

from __future__ import annotations

import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.ai.navigation.models import NavUiSummary
from app.ai.navigation.resolver import NavShapeProposal
from app.models.analysis import AnalysisReport
from app.models.emission import EmittedProject
from app.models.knowledge_graph import KnowledgeGraph
from app.models.plan import MigrationPlan
from app.models.validation import ValidatedScores, ValidationResult

SHOWCASE_SCHEMA_VERSION = 1


class ShowcaseBase(BaseModel):
    """Base: forbid unknown keys so the exported shape can never silently drift."""

    model_config = ConfigDict(extra="forbid")


# --- meta --------------------------------------------------------------------


class ShowcaseMeta(ShowcaseBase):
    """Provenance of the run — enough to reproduce it byte-for-byte.

    ``generatedAt`` is intentionally NOT wall-clock: it is the commit date of the
    benchmarked ``sample-app`` subtree (or ``SOURCE_DATE_EPOCH`` when set), so two
    exports of the same inputs are byte-identical.
    """

    schemaVersion: int = SHOWCASE_SCHEMA_VERSION
    generatedAt: str
    aiProvider: str
    rejoxVersion: str
    sampleProject: str
    sourceCommit: Optional[str] = None
    reproduce: str


# --- project -----------------------------------------------------------------


class ShowcaseCounts(ShowcaseBase):
    components: int
    pages: int
    routes: int
    apiEndpoints: int
    stores: int


class ShowcaseProject(ShowcaseBase):
    name: str
    sourceFiles: list[str] = Field(default_factory=list)
    counts: ShowcaseCounts
    stylingApproaches: list[str] = Field(default_factory=list)


# --- graph -------------------------------------------------------------------


class ShowcaseNode(ShowcaseBase):
    id: str
    label: str
    sourceFile: str
    # component / hook / store for graph entities; the KG file-type
    # (api / style / config / asset / other / component) for file nodes.
    kind: str


class ShowcaseEdge(ShowcaseBase):
    # Verbatim KG edge — never reshaped. ``from``/``to`` are real KG ids in the
    # same mixed id-space the engine emits (``renders`` uses component ids,
    # ``imports`` uses file paths); the node list below covers both.
    from_: str = Field(alias="from")
    to: str
    kind: str

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ShowcaseGraph(ShowcaseBase):
    nodes: list[ShowcaseNode] = Field(default_factory=list)
    edges: list[ShowcaseEdge] = Field(default_factory=list)


# --- waves -------------------------------------------------------------------


class ShowcaseWaveStep(ShowcaseBase):
    """One plan step, carrying the engine's OWN ``wave`` field (not a
    recomputation) plus title, kind and targets."""

    wave: int
    order: int
    title: str
    kind: str
    targets: list[str] = Field(default_factory=list)


# --- question ----------------------------------------------------------------


class ShowcaseQuestionOption(ShowcaseBase):
    id: str
    label: str
    isRecommended: bool


class ShowcaseQuestionEvidence(ShowcaseBase):
    """The genuine justification behind the navigator-shape question.

    This question is an AI *proposal*, not a formal analyzer finding, so there is
    no ``Issue``/``Evidence`` object behind it. What DID justify it is captured
    here verbatim: the AI's proposed shape + rationale, and the source nav UI
    summary (the only thing the LLM saw) that the proposal reasoned over.
    """

    proposedShape: str
    rationale: str
    fellBack: bool
    navComponent: str
    topLevelLinks: list[str] = Field(default_factory=list)


class ShowcaseQuestion(ShowcaseBase):
    id: str
    title: str
    # The planner's own question context — the verbatim justification string.
    context: str
    options: list[ShowcaseQuestionOption] = Field(default_factory=list)
    recommended: Optional[str] = None
    evidence: ShowcaseQuestionEvidence


# --- results -----------------------------------------------------------------


class ShowcaseContribution(ShowcaseBase):
    label: str
    delta: float
    reason: str
    evidence: str


class PhaseLlmCount(ShowcaseBase):
    """LLM calls attributed to one pipeline phase.

    ``calls`` is a MEASURED delta of the run's own call counter across the phase's
    boundary — never derived, assumed, or written as a literal (including the
    zeros). A phase whose count cannot be observed is omitted from the list, not
    reported as zero.
    """

    phase: str
    calls: int


class ShowcaseResults(ShowcaseBase):
    # Analyzer prediction (pre-migration).
    predictedCoverage: float
    predictedConfidence: float
    # Validated reality (post tsc + Metro), reported as two named lenses so
    # neither can be mistaken for "the" coverage:
    #   validatedStrictCoverage    — the HEADLINE. A unit counts only when
    #                                NOTHING was left unresolved in it.
    #   validatedCompilingCoverage — the forgiving lens: units that compile and
    #                                bundle, soft residue included. Directly
    #                                comparable to the Analyzer's prediction.
    # None where nothing was emitted: an empty population has no score.
    validatedStrictCoverage: Optional[float] = None
    validatedCompilingCoverage: Optional[float] = None
    validatedConfidence: Optional[float] = None
    tscPassed: bool
    tscErrorCount: int
    metroPassed: bool
    metroRan: bool
    llmCalls: int
    # Per-phase breakdown of ``llmCalls``, each a measured counter delta. The
    # phases whose calls could be observed sum to ``llmCalls``; the reading phases
    # (intelligence/analyze/plan) are the deterministic-understanding evidence.
    llmCallsByPhase: list[PhaseLlmCount] = Field(default_factory=list)
    repairRounds: int
    # The signed rows that sum to ``predictedCoverage``.
    contributions: list[ShowcaseContribution] = Field(default_factory=list)


# --- root --------------------------------------------------------------------


class ShowcaseData(ShowcaseBase):
    meta: ShowcaseMeta
    project: ShowcaseProject
    graph: ShowcaseGraph
    waves: list[ShowcaseWaveStep] = Field(default_factory=list)
    question: ShowcaseQuestion
    results: ShowcaseResults


# --- builders ----------------------------------------------------------------


def _build_graph(kg: KnowledgeGraph) -> ShowcaseGraph:
    """Reduce the Knowledge Graph to nodes + edges for a visualization.

    The KG's edges live in a MIXED id-space: ``renders``/``uses-store``/
    ``uses-hook`` reference component/hook/store ids (``file#Name``) while
    ``imports``/``calls-api`` reference plain file paths. We keep every edge
    verbatim and emit a node for both spaces so every endpoint resolves.
    """
    nodes: dict[str, ShowcaseNode] = {}

    def add(node_id: str, label: str, kind: str, source_file: str) -> None:
        if node_id not in nodes:
            nodes[node_id] = ShowcaseNode(
                id=node_id, label=label, kind=kind, sourceFile=source_file
            )

    for c in kg.components:
        add(c.id, c.name, "component", c.file)
    for h in kg.hooks:
        add(h.id, h.name, "hook", h.file)
    for s in kg.stateManagement.stores:
        add(s.id, s.name, "store", s.file)

    # File-path endpoints (imports / calls-api) that aren't already entity nodes.
    file_type = {f.path: f.type for f in kg.files}
    edges: list[ShowcaseEdge] = []
    for e in kg.edges:
        for endpoint in (e.from_, e.to):
            if endpoint not in nodes:
                add(endpoint, Path(endpoint).name, file_type.get(endpoint, "other"), endpoint)
        edges.append(ShowcaseEdge(from_=e.from_, to=e.to, kind=e.kind))

    return ShowcaseGraph(nodes=list(nodes.values()), edges=edges)


def _build_project(kg: KnowledgeGraph, report: AnalysisReport) -> ShowcaseProject:
    s = report.summary
    return ShowcaseProject(
        name=report.projectName,
        sourceFiles=[f.path for f in kg.files],
        counts=ShowcaseCounts(
            components=s.componentCount,
            pages=s.pageCount,
            routes=s.routeCount,
            apiEndpoints=s.apiEndpointCount,
            stores=s.storeCount,
        ),
        stylingApproaches=list(report.styling.approaches),
    )


def _build_question(
    proposal: NavShapeProposal, nav_ui: NavUiSummary
) -> ShowcaseQuestion:
    q = proposal.question
    recommended = next((o.id for o in q.options if o.isRecommended), None)
    spec = proposal.resolution.spec
    return ShowcaseQuestion(
        id=q.id,
        title=q.title,
        context=q.context,
        options=[
            ShowcaseQuestionOption(id=o.id, label=o.label, isRecommended=o.isRecommended)
            for o in q.options
        ],
        recommended=recommended,
        evidence=ShowcaseQuestionEvidence(
            proposedShape=spec.type.value if spec is not None else q.options[0].id,
            rationale=spec.rationale if spec is not None else "",
            fellBack=proposal.fellBack,
            navComponent=nav_ui.component,
            topLevelLinks=[link.label for link in nav_ui.links],
        ),
    )


def _build_results(
    report: AnalysisReport,
    scores: ValidatedScores,
    validation: ValidationResult,
    *,
    llm_calls: int,
    llm_by_phase: list[PhaseLlmCount],
    repair_rounds: int,
) -> ShowcaseResults:
    return ShowcaseResults(
        predictedCoverage=report.coverage,
        predictedConfidence=report.confidence,
        validatedCompilingCoverage=scores.workingCoverage,
        validatedStrictCoverage=scores.coverage,
        validatedConfidence=scores.confidence,
        tscPassed=validation.typecheck.passed,
        tscErrorCount=validation.typecheck.errorCount,
        metroPassed=validation.bundle.passed,
        metroRan=validation.bundle.ran,
        llmCalls=llm_calls,
        llmCallsByPhase=list(llm_by_phase),
        repairRounds=repair_rounds,
        contributions=[
            ShowcaseContribution(
                label=c.label, delta=c.delta, reason=c.reason, evidence=c.evidence
            )
            for c in report.contributions
        ],
    )


def showcase_json_schema() -> dict:
    """The JSON Schema the frontend type is generated from.

    Pydantic tags every field with a cosmetic ``title``; ``json-schema-to-
    typescript`` would hoist each into a noisy standalone alias. Titles carry no
    contract, so we strip the field-level ones (keeping model names, which come
    from the ``$defs`` keys) for a clean generated ``.d.ts``.
    """
    schema = ShowcaseData.model_json_schema(by_alias=True)
    _strip_field_titles(schema)
    return schema


def _strip_field_titles(node: object) -> None:
    if isinstance(node, dict):
        props = node.get("properties")
        if isinstance(props, dict):
            for prop in props.values():
                if isinstance(prop, dict):
                    prop.pop("title", None)
        for value in node.values():
            _strip_field_titles(value)
    elif isinstance(node, list):
        for item in node:
            _strip_field_titles(item)


def build_showcase_data(
    *,
    kg: KnowledgeGraph,
    report: AnalysisReport,
    plan: MigrationPlan,
    proposal: NavShapeProposal,
    nav_ui: NavUiSummary,
    scores: ValidatedScores,
    validation: ValidationResult,
    llm_calls: int,
    llm_by_phase: list[PhaseLlmCount],
    repair_rounds: int,
    meta: ShowcaseMeta,
) -> ShowcaseData:
    """Map real pipeline artifacts into the contract-checked showcase shape.

    Pure and total: it reads the artifacts a real run produced and rearranges
    them. It never invents a value — every field above traces to one of its
    typed inputs.
    """
    return ShowcaseData(
        meta=meta,
        project=_build_project(kg, report),
        graph=_build_graph(kg),
        waves=[
            ShowcaseWaveStep(
                wave=step.wave,
                order=step.order,
                title=step.title,
                kind=step.kind,
                targets=list(step.targets),
            )
            for step in plan.steps
        ],
        question=_build_question(proposal, nav_ui),
        results=_build_results(
            report, scores, validation,
            llm_calls=llm_calls, llm_by_phase=llm_by_phase, repair_rounds=repair_rounds,
        ),
    )


# --- reproducible meta -------------------------------------------------------


def resolve_meta(
    *, source_root: Path, repo_root: Path, provider_label: str, rejox_version: str
) -> ShowcaseMeta:
    """Build reproducible run metadata.

    ``generatedAt`` is derived from a stable input so two exports match byte for
    byte: ``SOURCE_DATE_EPOCH`` if set, else the git commit date of the
    ``sample-app`` subtree. The commit SHA is recorded for provenance.
    """
    import os

    sample_rel = _rel(source_root, repo_root)
    generated_at = None
    commit = None

    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    if epoch:
        generated_at = datetime.fromtimestamp(int(epoch), tz=timezone.utc).isoformat()
    else:
        iso, sha = _git_subtree_commit(repo_root, sample_rel)
        generated_at = iso
        commit = sha

    if generated_at is None:
        # Last-resort deterministic fallback: the schema epoch. Reported by the
        # caller so it is never mistaken for a real timestamp.
        generated_at = datetime.fromtimestamp(0, tz=timezone.utc).isoformat()

    return ShowcaseMeta(
        generatedAt=generated_at,
        aiProvider=provider_label,
        rejoxVersion=rejox_version,
        sampleProject=sample_rel,
        sourceCommit=commit,
        reproduce="REJOX_AI_PROVIDER=fake rejox export-showcase",
    )


def _rel(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.name


def _git_subtree_commit(repo_root: Path, sample_rel: str) -> tuple[Optional[str], Optional[str]]:
    """(commit-date-iso, sha) of the last commit touching the sample subtree, or
    (None, None) when git history is unavailable (e.g. a shallow export)."""
    try:
        out = subprocess.run(
            ["git", "-C", str(repo_root), "log", "-1", "--format=%cI\t%H", "--", sample_rel],
            capture_output=True, text=True, timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None, None
    line = out.stdout.strip()
    if out.returncode != 0 or not line or "\t" not in line:
        return None, None
    iso, sha = line.split("\t", 1)
    return iso.strip() or None, sha.strip() or None
