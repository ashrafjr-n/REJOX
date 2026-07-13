"""Full-project emission — assembling the whole React Native project.

The Deterministic Transformer converts one file at a time; ``emit_project``
assembles a runnable project out of them:

  1. scaffold the Expo (TS) skeleton (``scaffold.py``);
  2. transform every source ``.ts``/``.tsx`` file through the codemod-worker and
     write it into the RN tree (``components/``, ``screens/``, ``store/``,
     ``api/``, ``hooks/``, ``lib/`` — ``pages/`` is remapped to ``screens/``) —
     stores/api/hooks/types run through the *same* worker so nothing bypasses
     the rules;
  3. generate the React Navigation navigator from the route table (deterministic,
     from the Planner/Analyzer) and an ``App.tsx`` wiring it;
  4. copy real assets, skipping web-only ones (favicon / index.html / global CSS)
     with a recorded reason;
  5. write a ``REJOX-REPORT.md`` with per-file provenance.

Fully deterministic — no LLM. Every emitted file carries its
:class:`ConfidenceSource` provenance, so the Validator can wire Confidence to
validated reality rather than a static prediction.

    emit_project(plan, answers, kg, out_dir, *, report=None, source_root=None)
        -> EmittedProject
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any, Optional

from app.models.analysis import AnalysisReport, ConfidenceSource, RouteMapping
from app.models.emission import EmittedFile, EmittedProject, SkippedFile
from app.models.knowledge_graph import KnowledgeGraph
from app.models.plan import MigrationPlan
from app.models.transformation import TransformResult
from app.ai.navigation import generate_navigator, stack_spec_from_routes
from app.pipeline.analyzer import analyze_graph
from app.pipeline.scaffold import generate_scaffold
from app.pipeline.transformer import build_transform_options, transform_component

# Answer keys used by the Ask stage (questionId form) → codemod-worker option
# keys (camelCase). The scaffold reads the questionId form directly.
_ANSWER_TO_WORKER = {
    "project-type": "projectType",
    "styling-engine": "stylingEngine",
    "navigation-library": "navigationLibrary",
    "icons": "icons",
    "storage": "storage",
}

# Source files that are regenerated, never ported verbatim.
_REGENERATED = {"src/main.tsx", "src/App.tsx"}

# Web-only assets/files that have no place in an RN project.
_WEB_ONLY_ASSET_NAMES = {"favicon.svg", "favicon.ico", "vite.svg"}

_TODO_RE = re.compile(r"REJOX-TODO\(([A-Z_]+)\)")


# --- Path mapping ------------------------------------------------------------


def _target_rel(src_rel: str) -> str:
    """Map a source ``src/`` path to its place in the RN tree.

    Layout is preserved 1:1 so every relative import stays valid; the only
    remap is ``pages/`` → ``screens/`` (RN convention), and both live one level
    under ``src/`` so ``../components/X`` imports are unaffected.
    """
    parts = Path(src_rel).parts
    if len(parts) >= 2 and parts[0] == "src" and parts[1] == "pages":
        parts = (parts[0], "screens", *parts[2:])
    return str(Path(*parts))


def _provenance(result: TransformResult) -> ConfidenceSource:
    if result.unhandled:
        return ConfidenceSource.UNHANDLED
    if result.warnings:
        return ConfidenceSource.DETERMINISTIC_WARNING
    return ConfidenceSource.DETERMINISTIC


def _todo_codes(code: str) -> list[str]:
    return sorted(set(_TODO_RE.findall(code)))


# --- Navigator generation (deterministic, from the route table) --------------


def _navigator_source(routes: list[RouteMapping], nativewind: bool) -> tuple[str, list[str]]:
    """Generate ``src/navigation/AppNavigator.tsx`` from the route table.

    Navigator wiring is a **rule**, not a judgment call (NAV_CONTAINER tier 2):
    given the route table, the AI Resolution Engine's navigation generator emits
    a complete native-stack — screen names match the Analyzer's route table
    exactly, so the transformer's ``navigation.navigate('Screen', …)`` calls
    resolve. No NAV_CONTAINER TODO survives; the navigator SHAPE (stack vs tabs
    vs drawer) is a separate design decision surfaced as a Planner question
    (``navigation.resolver.infer_navigator_shape``), not code residue.
    """
    spec = stack_spec_from_routes(routes)
    return generate_navigator(spec, routes), []


def _app_source(has_navigator: bool, nativewind: bool, app_name: str) -> str:
    css = 'import "./global.css";\n' if nativewind else ""
    if has_navigator:
        return (
            css
            + "import { AppNavigator } from './src/navigation/AppNavigator';\n\n"
            + "export default function App() {\n"
            + "  return <AppNavigator />;\n}\n"
        )
    return (
        css
        + "import { Text, View } from 'react-native';\n\n"
        + "export default function App() {\n"
        + "  return (\n"
        + '    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>\n'
        + f"      <Text>{app_name}</Text>\n"
        + "    </View>\n  );\n}\n"
    )


# --- Emission ----------------------------------------------------------------


def emit_project(
    plan: MigrationPlan,
    answers: dict[str, str],
    kg: KnowledgeGraph,
    out_dir: Path | str,
    *,
    report: Optional[AnalysisReport] = None,
    source_root: Optional[Path | str] = None,
) -> EmittedProject:
    """Assemble the migrated React Native project into ``out_dir``.

    Args:
        plan: the Migration Plan (drives project name / structure).
        answers: Ask-stage answers in questionId form, e.g.
            ``{"project-type": "expo", "styling-engine": "nativewind",
            "navigation-library": "react-navigation"}``.
        kg: the Knowledge Graph of the source project.
        out_dir: directory to write the RN project into (created if missing).
        report: the Analysis Report; derived from ``kg`` if not supplied.
        source_root: root of the source project on disk; defaults to
            ``kg.project.root``.
    """
    report = report or analyze_graph(kg)
    src_root = Path(source_root or kg.project.root)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    styling = answers.get("styling-engine", "stylesheet")
    nativewind = styling == "nativewind"
    app_name = kg.project.name.replace("-", " ").title()

    # 1. scaffold.
    scaffold = generate_scaffold(out_dir, answers, kg.project.dependencies, app_name)
    files: list[EmittedFile] = []
    for rel in scaffold.files:
        files.append(
            EmittedFile(
                path=rel,
                sourceFile=None,
                provenance=ConfidenceSource.DETERMINISTIC_WARNING,  # generated shell
            )
        )

    # Worker options: answers (worker keys) + graph-derived routes/componentEvents.
    worker_answers = {
        _ANSWER_TO_WORKER.get(k, k): v for k, v in answers.items()
    }
    options = build_transform_options(kg, report, worker_answers)

    skipped: list[SkippedFile] = []

    # 2. transform every source .ts/.tsx (except regenerated entry files).
    source_ts = sorted(
        f.path
        for f in kg.files
        if f.path.startswith("src/")
        and f.path.endswith((".ts", ".tsx"))
        and f.path not in _REGENERATED
    )
    for src_rel in source_ts:
        abs_src = src_root / src_rel
        if not abs_src.is_file():
            skipped.append(SkippedFile(path=src_rel, reason="source file not found on disk"))
            continue
        result = transform_component(abs_src, options)

        # NAV_CONTAINER (tier 2): a shared <Layout>/<Outlet>/<Routes> component
        # is router structure, subsumed by the generated navigator. Skip it
        # rather than emit a dead <Outlet/> + a TODO — the shared chrome
        # (Navbar/Footer) becomes the navigator-shape decision (Planner question).
        if any(u.code == "NAV_CONTAINER" for u in result.unhandled):
            skipped.append(SkippedFile(
                path=src_rel,
                reason=(
                    "router-structure component (Outlet/Routes) subsumed by the "
                    "generated navigator; re-express its chrome via the chosen "
                    "navigator shape (see the navigation plan question)"
                ),
            ))
            # Defensive: drop any stale emission of this file from a prior run
            # into a reused out_dir, so a now-skipped file never lingers.
            (out_dir / _target_rel(src_rel)).unlink(missing_ok=True)
            continue

        target_rel = _target_rel(src_rel)
        target = out_dir / target_rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(result.code)
        files.append(
            EmittedFile(
                path=target_rel,
                sourceFile=src_rel,
                provenance=_provenance(result),
                warnings=result.warnings,
                unhandled=result.unhandled,
                todoCodes=_todo_codes(result.code),
            )
        )

    # 3. navigator + App.tsx.
    has_navigator = bool(report.routing.library and report.routing.routes)
    if has_navigator:
        nav_src, nav_todos = _navigator_source(report.routing.routes, nativewind)
        nav_rel = "src/navigation/AppNavigator.tsx"
        nav_path = out_dir / nav_rel
        nav_path.parent.mkdir(parents=True, exist_ok=True)
        nav_path.write_text(nav_src)
        files.append(
            EmittedFile(
                path=nav_rel,
                sourceFile="src/App.tsx",
                # Navigator wiring is a rule (generated from the route table);
                # the SHAPE decision lives in the Planner question, not here.
                provenance=ConfidenceSource.DETERMINISTIC_WARNING,
                unhandled=[],
                todoCodes=nav_todos,  # [] — no NAV_CONTAINER TODO survives
            )
        )

    app_src = _app_source(has_navigator, nativewind, app_name)
    (out_dir / "App.tsx").write_text(app_src)
    # App.tsx is in the scaffold list already; refresh its provenance/source.
    files = [f for f in files if f.path != "App.tsx"]
    files.append(
        EmittedFile(
            path="App.tsx",
            sourceFile="src/App.tsx",
            provenance=ConfidenceSource.DETERMINISTIC_WARNING,
        )
    )

    # 4. assets — copy real assets, skip web-only ones with a note.
    for asset in kg.assets:
        name = Path(asset.path).name
        if asset.path.startswith("public/") or name in _WEB_ONLY_ASSET_NAMES:
            skipped.append(SkippedFile(path=asset.path, reason="web-only asset (favicon/static)"))
            continue
        abs_asset = src_root / asset.path
        if not abs_asset.is_file():
            skipped.append(SkippedFile(path=asset.path, reason="asset not found on disk"))
            continue
        # Assets live under src/assets in the source; preserve that path.
        target = out_dir / asset.path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(abs_asset, target)
        files.append(
            EmittedFile(
                path=asset.path,
                sourceFile=asset.path,
                provenance=ConfidenceSource.DETERMINISTIC,
            )
        )

    # Note the web-only source files we never emit.
    for web_only in ("index.html", "src/index.css"):
        if any(f.path == web_only for f in kg.files):
            skipped.append(
                SkippedFile(
                    path=web_only,
                    reason="web-only (HTML entry / global CSS handled by the scaffold)",
                )
            )

    todo_count = sum(len(f.todoCodes) for f in files) + sum(
        len(f.unhandled) for f in files
    )
    # todoCodes and unhandled overlap (each unhandled leaves a TODO); count
    # residue by the emitted TODO comments, which is the ground truth.
    todo_count = sum(len(f.todoCodes) for f in files)

    project = EmittedProject(
        outDir=str(out_dir),
        files=sorted(files, key=lambda f: f.path),
        skipped=sorted(skipped, key=lambda s: s.path),
        todoCount=todo_count,
    )

    # 5. REJOX-REPORT.md
    (out_dir / "REJOX-REPORT.md").write_text(_render_report(project, kg))
    project.files.append(
        EmittedFile(
            path="REJOX-REPORT.md",
            sourceFile=None,
            provenance=ConfidenceSource.DETERMINISTIC,
        )
    )
    project.files.sort(key=lambda f: f.path)
    return project


# --- Report ------------------------------------------------------------------


def _render_report(project: EmittedProject, kg: KnowledgeGraph) -> str:
    lines: list[str] = []
    lines.append(f"# Rejox Migration Report — {kg.project.name}\n")
    lines.append(
        "Deterministic emission of the React Native project. Every file below "
        "was produced by rules (no AI). `unhandled` items are the residue the "
        "AI Resolution Engine will resolve; each also leaves a "
        "`// REJOX-TODO(<CODE>)` marker in the code.\n"
    )

    residue = [f for f in project.files if f.unhandled]
    clean = [f for f in project.files if f.sourceFile and not f.unhandled and not f.warnings]

    lines.append(f"\n## Summary\n")
    lines.append(f"- Files emitted: **{len(project.files)}**")
    lines.append(f"- Files with residue (TODOs): **{len(residue)}**")
    lines.append(f"- Total REJOX-TODO items: **{project.todoCount}**")
    lines.append(f"- Files skipped (web-only / not found): **{len(project.skipped)}**\n")

    lines.append("\n## Provenance (per file)\n")
    lines.append("| File | From | Provenance | Residue |")
    lines.append("| ---- | ---- | ---------- | ------- |")
    for f in project.files:
        codes = ", ".join(u.code for u in f.unhandled) or (
            ", ".join(f.todoCodes) if f.todoCodes else "—"
        )
        lines.append(
            f"| `{f.path}` | {f.sourceFile or '_(generated)_'} | "
            f"{f.provenance.value} | {codes} |"
        )

    if project.skipped:
        lines.append("\n## Skipped\n")
        for s in project.skipped:
            lines.append(f"- `{s.path}` — {s.reason}")

    lines.append("")
    return "\n".join(lines)
