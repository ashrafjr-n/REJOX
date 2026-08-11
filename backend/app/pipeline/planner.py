"""Planner stage.

Turns an :class:`AnalysisReport` (plus the Knowledge Graph it was derived from)
into an ordered Migration Plan and the Questions the Ask stage will put to the
user. Pure and deterministic — it transforms findings into a plan; it converts
nothing and never calls an LLM.

``plan_migration(report, kg)`` is the single entry point.

Question rules — a question is emitted ONLY when a finding justifies it:
  - project-type   : always (we always scaffold a target app).
  - styling-engine : any Tailwind usage (styling.tailwindClassCount > 0).
  - navigation-lib : react-router detected (routing.library set).
  - icons          : an icon library present in dependencies.
  - storage        : localStorage/sessionStorage in any component's webApis.
Exactly one option per question is recommended; the rule is documented at each.

Step ordering — the step list is derived from the report, not hardcoded:
  setup → routing → state → api → component waves → styling → assets →
  navigation → validation. Content steps with no targets are omitted. Component
  conversion is split into dependency *waves* via the KG `renders` edges
  (leaf/shared components first, pages last) using Kahn's algorithm.

Failures are typed: anything that blows up while planning is re-raised as a
:class:`PlannerError` naming the phase and the report it was planning over — the
same contract the stages around it (``AnalyzerError``, ``TransformerError``,
``ValidatorError``) provide.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from app.models.analysis import AnalysisReport
from app.models.knowledge_graph import KnowledgeGraph
from app.models.plan import (
    ManualReviewCandidate,
    MigrationPlan,
    PlanStep,
    Question,
    QuestionOption,
    StepFinding,
    UnsupportedItem,
)

# Icon libraries whose presence justifies an icons question.
ICON_LIBS = frozenset({
    "lucide-react", "react-icons", "@heroicons/react",
    "@mui/icons-material", "react-feather", "@fortawesome/react-fontawesome",
    "@radix-ui/react-icons",
})

# Browser storage APIs that map to AsyncStorage/MMKV.
STORAGE_WEB_APIS = frozenset({"localStorage", "sessionStorage"})

# Suggestions for unsupported libraries (see docs/PRD.md NOT-supported list).
UNSUPPORTED_SUGGESTIONS = {
    "redux": "Port state to zustand (supported) before conversion.",
    "react-redux": "Port state to zustand (supported) before conversion.",
    "@reduxjs/toolkit": "Port state to zustand (supported) before conversion.",
    "three": "3D/WebGL has no RN equivalent in the MVP; remove or defer it.",
    "@react-three/fiber": "3D/WebGL has no RN equivalent in the MVP; remove or defer it.",
    "next": "Extract app code out of Next.js; SSR/Next is out of scope.",
    "electron": "Desktop shell is unsupported; target mobile platforms only.",
}


class PlannerError(RuntimeError):
    """Raised when the Planner cannot turn a report + graph into a plan.

    The Planner is deterministic and total over a valid report, so this means a
    planning phase hit content it could not handle — a defect, not user input.
    The message carries the failing phase plus the report's shape so the failure
    is diagnosable from the message alone.
    """


def _plan_context(report: AnalysisReport, kg: KnowledgeGraph) -> str:
    """The report/KG facts worth embedding in a failure message."""
    return (
        f"project '{report.projectName}' ({len(report.components)} components, "
        f"{len(report.routing.routes)} routes, {len(kg.edges)} graph edges, "
        f"{len(report.blockers)} blockers)"
    )


@contextmanager
def _phase(label: str, report: AnalysisReport, kg: KnowledgeGraph) -> Iterator[None]:
    """Run one planning phase, tagging any failure with the phase + context."""
    try:
        yield
    except PlannerError:
        raise  # already tagged — never re-wrap
    except Exception as exc:
        raise PlannerError(
            f"Planner failed in {label} for {_plan_context(report, kg)}: "
            f"{type(exc).__name__}: {exc}"
        ) from exc


# --- Small helpers ----------------------------------------------------------


def _tailwind_component_count(kg: KnowledgeGraph) -> int:
    return sum(1 for c in kg.components if "tailwind" in c.stylingApproach)


def _package_target(kg: KnowledgeGraph) -> str:
    """A stable, always-present target for project-level steps."""
    for f in kg.files:
        if f.path == "package.json":
            return "package.json"
    return kg.project.name


# --- Questions --------------------------------------------------------------


def _questions(report: AnalysisReport, kg: KnowledgeGraph) -> list[Question]:
    questions: list[Question] = []
    s = report.summary

    # project-type — always. Recommend Expo for the MVP (fastest path to a
    # runnable app; Metro/OTA/library coverage).
    questions.append(
        Question(
            id="project-type",
            title="Which React Native scaffold should we target?",
            context=(
                f"{s.componentCount} components and {s.routeCount} routes will be "
                "scaffolded into a fresh React Native project."
            ),
            options=[
                QuestionOption(
                    id="expo",
                    label="Expo",
                    description="Managed Expo application.",
                    tradeoffs=(
                        "Fastest setup, OTA updates, broad library support. "
                        "Some native modules need config plugins."
                    ),
                    isRecommended=True,
                ),
                QuestionOption(
                    id="bare-rn",
                    label="Bare React Native",
                    description="A `react-native` CLI project.",
                    tradeoffs=(
                        "Full native control from day one. "
                        "More native tooling to set up and maintain."
                    ),
                ),
            ],
            required=True,
        )
    )

    # styling-engine — only if Tailwind is used. Recommend NativeWind because
    # Tailwind is the dominant styling approach (preserves the most classes).
    if report.styling.tailwindClassCount > 0:
        tw_components = _tailwind_component_count(kg)
        questions.append(
            Question(
                id="styling-engine",
                title="How should Tailwind styling be migrated?",
                context=(
                    f"{report.styling.tailwindClassCount} Tailwind classes across "
                    f"{tw_components} components "
                    f"({len(report.styling.unmappableClasses)} unmappable), "
                    f"{report.styling.cssModuleCount} CSS Module(s)."
                ),
                options=[
                    QuestionOption(
                        id="nativewind",
                        label="NativeWind",
                        description="Tailwind-for-RN; keep className-based styling.",
                        tradeoffs=(
                            "Preserves most Tailwind classes with minimal churn. "
                            "A few utilities (hover, grid) still need manual work."
                        ),
                        isRecommended=True,
                    ),
                    QuestionOption(
                        id="stylesheet",
                        label="RN StyleSheet",
                        description="Rewrite styles as StyleSheet.create objects.",
                        tradeoffs=(
                            "Idiomatic, dependency-free RN styling. "
                            "Every className must be rewritten by hand."
                        ),
                    ),
                ],
                required=True,
            )
        )

    # navigation-library — only if react-router is present. Recommend React
    # Navigation: mature and works with both Expo and bare RN.
    if report.routing.library:
        param_routes = sum(1 for r in report.routing.routes if r.hasParams)
        questions.append(
            Question(
                id="navigation-library",
                title="Which navigation library should replace react-router?",
                context=(
                    f"{report.routing.library} with {s.routeCount} routes "
                    f"({param_routes} parameterized)."
                ),
                options=[
                    QuestionOption(
                        id="react-navigation",
                        label="React Navigation",
                        description="Imperative navigators (stack/tab).",
                        tradeoffs=(
                            "Mature, well-documented, works with Expo and bare RN. "
                            "Navigator config is written by hand."
                        ),
                        isRecommended=True,
                    ),
                    QuestionOption(
                        id="expo-router",
                        label="Expo Router",
                        description="File-based routing, Next.js-like.",
                        tradeoffs=(
                            "Familiar file-based model, deep linking built in. "
                            "Newer and tied to Expo conventions."
                        ),
                    ),
                ],
                required=True,
            )
        )

    # icons — only if an icon library is actually a dependency.
    icon_libs = sorted(d for d in kg.project.dependencies if d in ICON_LIBS)
    if icon_libs:
        questions.append(
            Question(
                id="icons",
                title="How should web icons be replaced?",
                context=f"{', '.join(icon_libs)} detected in dependencies.",
                options=[
                    QuestionOption(
                        id="expo-vector-icons",
                        label="@expo/vector-icons",
                        description="Bundled icon sets for Expo.",
                        tradeoffs=(
                            "Zero-config in Expo, large icon coverage. "
                            "Icon names differ from the web set."
                        ),
                        isRecommended=True,
                    ),
                    QuestionOption(
                        id="lucide-rn",
                        label="lucide-react-native",
                        description="Lucide icons for React Native.",
                        tradeoffs=(
                            "Same icon set as lucide-react on web. "
                            "Needs react-native-svg."
                        ),
                    ),
                ],
                required=False,
            )
        )

    # storage — only if browser storage is used in a component.
    storage_users = sorted(
        c.name
        for c in kg.components
        if STORAGE_WEB_APIS.intersection(c.webApis)
    )
    if storage_users:
        questions.append(
            Question(
                id="storage",
                title="Which storage should replace browser storage?",
                context=(
                    f"Browser storage used in {len(storage_users)} component(s): "
                    f"{', '.join(storage_users)}."
                ),
                options=[
                    QuestionOption(
                        id="async-storage",
                        label="AsyncStorage",
                        description="@react-native-async-storage/async-storage.",
                        tradeoffs=(
                            "Standard, async key-value store. "
                            "Call sites must become async/awaited."
                        ),
                        isRecommended=True,
                    ),
                    QuestionOption(
                        id="mmkv",
                        label="react-native-mmkv",
                        description="Fast synchronous key-value store.",
                        tradeoffs=(
                            "Very fast and synchronous (drop-in for localStorage). "
                            "A native dependency; not usable in Expo Go."
                        ),
                    ),
                ],
                required=True,
            )
        )

    return questions


# --- Component waves (topological over `renders` edges) ---------------------


def _component_waves(report: AnalysisReport, kg: KnowledgeGraph) -> list[list[str]]:
    """Group components into dependency waves: a component is placed only once
    every component it renders is already placed (leaves first, pages last).
    """
    ids = [c.componentId for c in report.components]
    idset = set(ids)

    deps: dict[str, set[str]] = {i: set() for i in ids}
    for e in kg.edges:
        if (
            e.kind == "renders"
            and e.from_ in idset
            and e.to in idset
            and e.from_ != e.to
        ):
            deps[e.from_].add(e.to)

    waves: list[list[str]] = []
    placed: set[str] = set()
    remaining = set(ids)
    while remaining:
        ready = sorted(n for n in remaining if deps[n] <= placed)
        if not ready:
            # A render cycle (recursive components) — place the rest as one
            # deterministic final wave rather than looping forever.
            ready = sorted(remaining)
        waves.append(ready)
        placed.update(ready)
        remaining.difference_update(ready)
    return waves


# --- Steps ------------------------------------------------------------------


def _wave_effort(size: int) -> str:
    if size <= 3:
        return "small"
    if size <= 8:
        return "medium"
    return "large"


def _steps(
    report: AnalysisReport,
    kg: KnowledgeGraph,
    waves: list[list[str]],
    question_ids: list[str],
) -> list[PlanStep]:
    steps: list[PlanStep] = []
    created: set[str] = set()
    pkg = _package_target(kg)

    def has_q(qid: str) -> bool:
        return qid in question_ids

    def add(step: PlanStep) -> None:
        # Keep dependsOn honest — only reference steps that exist.
        step.dependsOn = [d for d in step.dependsOn if d in created]
        step.order = len(steps) + 1
        steps.append(step)
        created.add(step.id)

    # 1. setup — always first, affected by every question.
    add(PlanStep(
        id="setup", order=0, kind="setup",
        title="Scaffold the target React Native project",
        description="Create the RN/Expo app and install the chosen dependencies.",
        targets=[pkg],
        estimatedEffort="medium",
        dependsOn=[],
        affectedByQuestions=list(question_ids),
        notes="Installs replacements for react-dom/vite and the chosen libraries.",
    ))

    # 2. routing — design the navigator from the route table.
    if report.routing.library:
        route_targets = sorted({r.file for r in kg.routes if r.file})
        add(PlanStep(
            id="routing", order=0, kind="routing",
            title="Map routes to a navigator structure",
            description=(
                f"Translate {len(kg.routes)} react-router route(s) into a "
                "React Navigation navigator (screens + params)."
            ),
            targets=route_targets or [pkg],
            estimatedEffort="small",
            dependsOn=["setup"],
            affectedByQuestions=[q for q in ["navigation-library"] if has_q(q)],
        ))

    # 3. state stores — zustand ports mostly as-is.
    store_files = sorted({s.file for s in kg.stateManagement.stores})
    if store_files:
        add(PlanStep(
            id="state", order=0, kind="state",
            title="Port state stores",
            description=(
                f"Move {len(store_files)} {kg.stateManagement.library} store(s); "
                "these generally run unchanged in RN."
            ),
            targets=store_files,
            estimatedEffort="small" if len(store_files) <= 2 else "medium",
            dependsOn=["setup"],
            affectedByQuestions=[q for q in ["storage"] if has_q(q)],
        ))

    # 4. api layer — axios/fetch, usually compatible.
    api_files = sorted(
        {c.file for c in kg.apiLayer.clients} | {e.file for e in kg.apiLayer.endpoints}
    )
    if api_files:
        add(PlanStep(
            id="api", order=0, kind="api",
            title="Carry over the API layer",
            description=(
                f"{len(kg.apiLayer.endpoints)} endpoint(s) across {len(api_files)} "
                "file(s); axios/fetch run as-is in RN."
            ),
            targets=api_files,
            estimatedEffort="small",
            dependsOn=["setup"],
        ))

    # 5. component conversion waves (leaves → pages).
    wave_ids: list[str] = []
    for idx, wave in enumerate(waves, start=1):
        wave_id = f"components-wave-{idx}"
        depends = [wave_ids[-1]] if wave_ids else ["setup", "state", "api"]
        add(PlanStep(
            id=wave_id, order=0, kind="components",
            title=f"Convert component wave {idx} ({len(wave)})",
            description=(
                "Convert this dependency wave "
                f"({'leaf/shared components' if idx == 1 else 'depends on earlier waves'})."
            ),
            targets=wave,
            estimatedEffort=_wave_effort(len(wave)),
            dependsOn=depends,
            notes="Order derived from KG renders-edges (children before parents).",
        ))
        wave_ids.append(wave_id)

    # 6. styling pass.
    styled = sorted(
        c.id for c in kg.components
        if "tailwind" in c.stylingApproach or "css-module" in c.stylingApproach
    )
    if styled:
        add(PlanStep(
            id="styling", order=0, kind="styling",
            title="Apply the styling pass",
            description="Re-express styles under the chosen engine and fix unmappable utilities.",
            targets=styled,
            estimatedEffort="large" if len(report.styling.unmappableClasses) > 10 else "medium",
            dependsOn=[wave_ids[-1]] if wave_ids else ["setup"],
            affectedByQuestions=[q for q in ["styling-engine"] if has_q(q)],
            notes=(
                f"{report.styling.tailwindClassCount} Tailwind classes; "
                f"{len(report.styling.unmappableClasses)} unmappable need manual work."
            ),
        ))

    # 7. assets.
    asset_targets = sorted(a.path for a in kg.assets)
    if asset_targets:
        add(PlanStep(
            id="assets", order=0, kind="assets",
            title="Move static assets",
            description=f"Copy {len(asset_targets)} asset(s) and rewire references.",
            targets=asset_targets,
            estimatedEffort="small",
            dependsOn=["setup"],
            affectedByQuestions=[q for q in ["icons"] if has_q(q)],
        ))

    # 8. navigation wiring — plug converted screens into the navigator.
    if report.routing.library:
        screen_targets = sorted(
            {r.componentName for r in report.routing.routes if r.componentName}
        )
        depends = ["routing"]
        if wave_ids:
            depends.append(wave_ids[-1])
        add(PlanStep(
            id="navigation", order=0, kind="navigation",
            title="Wire screens into the navigator",
            description="Register the converted page components as navigator screens.",
            targets=screen_targets or [pkg],
            estimatedEffort="small",
            dependsOn=depends,
            affectedByQuestions=[q for q in ["navigation-library"] if has_q(q)],
        ))

    # 9. validation — always last; depends on everything emitted so far.
    tsconfigs = sorted(f.path for f in kg.files if f.path.startswith("tsconfig"))
    add(PlanStep(
        id="validation", order=0, kind="validation",
        title="Validate the converted project",
        description="Run tsc --noEmit and a Metro build; loop back on failures.",
        targets=[pkg] + tsconfigs,
        estimatedEffort="medium",
        dependsOn=sorted(created),
    ))

    return steps


# --- Waves (topological layer of each step over its dependsOn edges) ---------


def _assign_waves(steps: list[PlanStep]) -> None:
    """Set ``step.wave`` = its longest-path layer over ``dependsOn`` (leaves = 0).

    ``dependsOn`` only ever references already-created steps, so the step graph
    is a DAG by construction; the visiting guard is belt-and-braces. This is the
    *step* wave (the plan DAG's layering), a superset concept over the component
    ``renders`` waves that produced the component-conversion steps.
    """
    by_id = {s.id: s for s in steps}
    memo: dict[str, int] = {}
    visiting: set[str] = set()

    def wave_of(sid: str) -> int:
        cached = memo.get(sid)
        if cached is not None:
            return cached
        step = by_id.get(sid)
        deps = [d for d in (step.dependsOn if step else []) if d in by_id]
        if not step or not deps:
            memo[sid] = 0
            return 0
        if sid in visiting:  # defensive: never loop on an unexpected cycle
            return 0
        visiting.add(sid)
        wave = 1 + max(wave_of(d) for d in deps)
        visiting.discard(sid)
        memo[sid] = wave
        return wave

    for s in steps:
        s.wave = wave_of(s.id)


# --- Findings (per-step, associated over real KG ids) -----------------------

_REVIEW_ISSUE_CODES = frozenset({"CSS_MODULE", "DYNAMIC_CLASSNAME"})


def _component_findings(report: AnalysisReport) -> list[tuple[str, StepFinding]]:
    """Every review-worthy finding, as ``(source_file, StepFinding)`` pairs.

    Same signal the manual-review list is built from (difficulty ≥ medium, plus
    the review issue codes), but structured and keyed by the component's source
    *file* so it can attach to any step whose targets touch that file.
    """
    out: list[tuple[str, StepFinding]] = []
    for c in report.components:
        if c.difficulty in ("medium", "hard", "blocked"):
            out.append((
                c.file,
                StepFinding(
                    componentId=c.componentId,
                    code="DIFFICULTY",
                    severity="blocker" if c.difficulty == "blocked" else "warning",
                    message=f"difficulty={c.difficulty} (score {c.score})",
                ),
            ))
        for issue in c.issues:
            if issue.code in _REVIEW_ISSUE_CODES:
                out.append((
                    c.file,
                    StepFinding(
                        componentId=c.componentId,
                        code=issue.code,
                        severity=issue.severity,
                        message=issue.message,
                    ),
                ))
    return out


def _attach_findings(steps: list[PlanStep], report: AnalysisReport) -> None:
    """Attach each finding to every step whose targets touch its source file.

    A target may be a bare file (``src/pages/X.tsx``) or a KG id
    (``src/pages/X.tsx#X``); we match on the file portion, so a page's finding
    reaches the routing step (file target) AND its component wave (id target) —
    not only the component waves the old frontend join could see.
    """
    findings = _component_findings(report)
    for step in steps:
        target_files = {t.split("#", 1)[0] for t in step.targets}
        step.findings = [f for (file, f) in findings if file in target_files]


# --- Review + unsupported ---------------------------------------------------


def _manual_review(report: AnalysisReport) -> list[ManualReviewCandidate]:
    reasons: dict[str, list[str]] = {}
    for c in report.components:
        found: list[str] = []
        if c.difficulty in ("medium", "hard", "blocked"):
            found.append(f"difficulty={c.difficulty} (score {c.score})")
        for issue in c.issues:
            if issue.code in _REVIEW_ISSUE_CODES:
                found.append(f"{issue.code}: {issue.message}")
        if found:
            reasons[c.componentId] = found
    return [
        ManualReviewCandidate(componentId=cid, reason="; ".join(rs))
        for cid, rs in sorted(reasons.items())
    ]


def _unsupported(report: AnalysisReport) -> list[UnsupportedItem]:
    items: list[UnsupportedItem] = []
    for lib in report.libraries:
        if lib.status == "unsupported":
            items.append(
                UnsupportedItem(
                    name=lib.name,
                    reason=lib.notes or "Unsupported in the MVP.",
                    suggestion=UNSUPPORTED_SUGGESTIONS.get(
                        lib.name, "Remove or replace before conversion."
                    ),
                )
            )
    return items


# --- Entry point ------------------------------------------------------------


def plan_migration(report: AnalysisReport, kg: KnowledgeGraph) -> MigrationPlan:
    """Build the ordered Migration Plan and Ask-stage questions.

    Raises:
        PlannerError: if any planning phase fails on this report/graph.
    """
    with _phase("questions", report, kg):
        questions = _questions(report, kg)
        question_ids = [q.id for q in questions]
    with _phase("component waves", report, kg):
        waves = _component_waves(report, kg)
    with _phase("steps", report, kg):
        steps = _steps(report, kg, waves, question_ids)
    with _phase("step waves", report, kg):
        _assign_waves(steps)      # each step's topological layer (was UI-side)
    with _phase("step findings", report, kg):
        _attach_findings(steps, report)  # per-step issues over real KG ids

    with _phase("plan assembly", report, kg):
        return MigrationPlan(
            projectName=report.projectName,
            questions=questions,
            steps=steps,
            manualReviewCandidates=_manual_review(report),
            unsupportedItems=_unsupported(report),
        )
