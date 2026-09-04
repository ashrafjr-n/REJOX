"""Full-project emission — assembling the whole React Native project.

The Deterministic Transformer converts one file at a time; ``emit_project``
assembles a runnable project out of them:

  1. scaffold the Expo (TS) skeleton (``scaffold.py``);
  2. transform every source ``.ts``/``.tsx``/``.js``/``.jsx`` file through the
     codemod-worker and write it into the RN tree (``components/``, ``screens/``,
     ``store/``, ``api/``, ``hooks/``, ``lib/`` — ``pages/`` is remapped to
     ``screens/``, and a ``.js``/``.jsx`` source's extension is rewritten to
     ``.ts``/``.tsx``) — stores/api/hooks/types run through the *same* worker so
     nothing bypasses the rules;
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

import posixpath
import re
import shutil
from collections import Counter
from pathlib import Path
from typing import Any, Optional

from app.ai.cache import ResolutionCache
from app.ai.provider import LLMProvider
from app.models.analysis import AnalysisReport, ConfidenceSource, RouteMapping
from app.models.emission import EmittedFile, EmittedProject, SkippedFile
from app.models.knowledge_graph import EntryPoint, KnowledgeGraph, RootProvider
from app.models.plan import MigrationPlan
from app.models.transformation import TransformResult
from app.ai.navigation import build_navigator_spec, generate_navigator, unhoistable_screens
from app.pipeline.analyzer import analyze_graph
from app.pipeline.resolve_apply import apply_resolutions
from app.pipeline.scaffold import generate_scaffold
from app.pipeline.transformer import (
    TransformerError,
    build_transform_options,
    transform_component,
)

# Answer keys used by the Ask stage (questionId form) → codemod-worker option
# keys (camelCase). The scaffold reads the questionId form directly.
_ANSWER_TO_WORKER = {
    "project-type": "projectType",
    "styling-engine": "stylingEngine",
    "navigation-library": "navigationLibrary",
    "icons": "icons",
    "storage": "storage",
}

# Source extensions the transformer accepts. The codemod-worker itself is
# extension-agnostic (it always parses content as TSX — see convert.ts), so
# this list is the only place "which files get converted" is decided.
_SOURCE_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx")

# Entry files that are regenerated, never ported verbatim — matched by STEM,
# not a literal ".tsx" path, so a plain-JS project's real src/App.jsx and
# src/main.jsx are recognized too (see _regenerated_source_paths).
_REGENERATED_STEMS = {"src/App", "src/main"}

# --- What never reaches the React Native project -----------------------------
#
# ONE list rather than a check per loop. Everything below is web-only or
# build-only: emitting it produces a file that cannot work in React Native, and
# scattering these rules is how `vite-env.d.ts` (which references `vite/client`
# types the RN project does not have) reached a migrated project unnoticed.
# Every rule returns the reason that lands in REJOX-REPORT.md, so a skip is
# always an auditable decision and never a silent omission.

_WEB_ONLY_ASSET_NAMES = {"favicon.svg", "favicon.ico", "vite.svg"}

# Ambient type shims that describe a WEB build — they reference bundler types
# that do not exist in an RN project and declare web asset modules.
_BUILD_SHIM_NAMES = {"vite-env.d.ts", "react-app-env.d.ts", "next-env.d.ts"}

# Tests are not the runtime app, and their web testing libraries
# (@testing-library/react, jsdom) have no React Native equivalent.
_TEST_FILE_RE = re.compile(r"\.(test|spec)\.[jt]sx?$")


def _never_migrate(rel_path: str) -> Optional[str]:
    """Why this file must never reach the RN project, or ``None`` to migrate it."""
    name = posixpath.basename(rel_path)
    if name == "index.html":
        return "web-only (HTML entry — the scaffold provides the RN entry point)"
    if rel_path.startswith("public/"):
        return "web-only asset (public/ is a web static directory)"
    if name in _WEB_ONLY_ASSET_NAMES:
        return "web-only asset (favicon/static)"
    if name in _BUILD_SHIM_NAMES:
        return "web build shim (references bundler types React Native does not have)"
    if _TEST_FILE_RE.search(name):
        return "test file (not the runtime app; its web testing libraries have no RN equivalent)"
    if name.endswith(".css"):
        return "web-only (global CSS is handled by the scaffold)"
    return None

_TODO_RE = re.compile(r"REJOX-TODO\(([A-Z_]+)\)")


# --- Path mapping ------------------------------------------------------------


# Every emitted file lands in a TypeScript scaffold (tsconfig.json only
# includes **/*.ts and **/*.tsx), so a .js/.jsx source is retargeted to
# .ts/.tsx — otherwise tsc silently never sees it at all.
_TARGET_EXTENSIONS = {".jsx": ".tsx", ".js": ".ts"}


def _target_rel(src_rel: str) -> str:
    """Map a source ``src/`` path to its place in the RN tree.

    Layout is preserved 1:1 so every relative import stays valid; the only
    remaps are ``pages/`` → ``screens/`` (RN convention, both one level under
    ``src/`` so ``../components/X`` imports are unaffected) and a .js/.jsx
    source's extension → .ts/.tsx (the scaffold's own convention).
    """
    parts = Path(src_rel).parts
    if len(parts) >= 2 and parts[0] == "src" and parts[1] == "pages":
        parts = (parts[0], "screens", *parts[2:])
    target = Path(*parts)
    new_ext = _TARGET_EXTENSIONS.get(target.suffix)
    if new_ext:
        target = target.with_suffix(new_ext)
    return str(target)


def _regenerated_source_paths(kg: KnowledgeGraph) -> dict[str, str]:
    """The real source path for each regenerated entry, whatever extension
    this project actually uses (``src/App.jsx`` as readily as ``src/App.tsx``).

    Keyed by stem (``"src/App"``, ``"src/main"``) so callers can look up the
    real App source for provenance without re-deriving it.
    """
    found: dict[str, str] = {}
    for f in kg.files:
        stem = str(Path(f.path).with_suffix(""))
        if stem in _REGENERATED_STEMS:
            found[stem] = f.path
    return found


def _screen_import_paths(kg: KnowledgeGraph, emitted: set[str]) -> dict[str, str]:
    """Component name → its import path relative to ``src/navigation/``.

    Derived from where each file ACTUALLY landed, not from a directory
    convention: a routed screen does not have to live under ``pages/``, and
    assuming it does writes an import to a file that was never emitted.
    Components that were not emitted (skipped, or not on disk) are left out, so
    the generator falls back to its own default for them.
    """
    paths: dict[str, str] = {}
    for c in kg.components:
        target = _target_rel(c.file)
        if target not in emitted or c.name in paths:
            continue
        rel = posixpath.relpath(target, "src/navigation")
        paths[c.name] = posixpath.splitext(rel)[0]
    return paths


def _provenance(result: TransformResult) -> ConfidenceSource:
    if result.unhandled:
        return ConfidenceSource.UNHANDLED
    if result.warnings:
        return ConfidenceSource.DETERMINISTIC_WARNING
    return ConfidenceSource.DETERMINISTIC


def _todo_codes(code: str) -> list[str]:
    return sorted(set(_TODO_RE.findall(code)))


# --- Navigator generation (deterministic, from the route table) --------------


def _navigator_source(
    routes: list[RouteMapping],
    nav_shape: str,
    import_paths: Optional[dict[str, str]] = None,
) -> tuple[str, list[str]]:
    """Generate ``src/navigation/AppNavigator.tsx`` for the CHOSEN shape.

    Navigator wiring is a **rule** (NAV_CONTAINER tier 2): the route table makes
    screen wiring mechanical. The SHAPE (``stack``/``tabs``/``drawer``) is the
    one decision — chosen by the user / the tier-3 LLM proposal and passed in via
    ``answers['navigator-shape']`` — and the generator writes the code for it.
    No NAV_CONTAINER TODO survives.

    A route element that carried props is the one thing wiring cannot settle by
    itself: where the props are plain reads of the routing component's state the
    generator relocates them, and where they are not it leaves NAV_SCREEN_PROPS
    for the AI Resolution Engine.
    """
    spec = build_navigator_spec(nav_shape, routes)
    todos = ["NAV_SCREEN_PROPS"] if unhoistable_screens(spec, routes) else []
    return generate_navigator(spec, routes, import_paths), todos


def _module_specifier(from_root: str, target_rel: str) -> str:
    """Import specifier for ``target_rel`` as seen from the project root.

    The root ``App.tsx`` sits one level above the emitted tree, so a file that
    landed at ``src/services/store.ts`` is ``./src/services/store`` from there —
    derived from where the file ACTUALLY landed, never from a directory
    convention (the same rule ``_screen_import_paths`` follows).
    """
    del from_root
    without_ext = str(Path(target_rel).with_suffix(""))
    return f"./{without_ext}"


def _package_root(specifier: str) -> str:
    """The installable package name of a module specifier.

    ``@reduxjs/toolkit/query/react`` is supplied by ``@reduxjs/toolkit``; a
    deep import is not its own dependency.
    """
    parts = specifier.split("/")
    return "/".join(parts[:2]) if specifier.startswith("@") else parts[0]


def _entry_imports(
    entry: Optional[EntryPoint],
    emitted_paths: set[str],
    available_packages: set[str],
) -> tuple[list[str], list[str], list[RootProvider], list[str]]:
    """Render the entry file's provider chain into import/declaration source.

    Returns ``(imports, declarations, providers, todos)``. A provider whose
    values cannot be carried over — the file that supplied one was skipped, its
    package did not reach package.json, or the entry extractor could not
    resolve it — is NOT emitted with a dangling import: it is dropped with a ``REJOX-TODO(ENTRY_PROVIDER)`` naming it, so a
    lost provider is always visible rather than silently absent.
    """
    if entry is None or not entry.providers:
        return [], [], [], []

    unresolved: set[str] = {
        b.local for b in entry.bindings if b.module is None and b.declaration is None
    }
    # A same-project value is only importable if its file reached the output.
    binding_specifier: dict[str, str] = {}
    for b in entry.bindings:
        if b.module is None:
            continue
        if b.resolvedFile is None:
            # A package only reaches the import if it reached package.json. The
            # scaffold drops a dependency whose version spec is not a plain
            # registry range (see scaffold._safe_version), and importing what
            # was deliberately not installed is a dangling import, not a lift.
            if _package_root(b.module) not in available_packages:
                unresolved.add(b.local)
                continue
            binding_specifier[b.local] = b.module  # a package: import as written
            continue
        landed = _target_rel(b.resolvedFile)
        if landed not in emitted_paths:
            unresolved.add(b.local)
            continue
        binding_specifier[b.local] = _module_specifier("App.tsx", landed)

    providers: list[RootProvider] = []
    todos: list[str] = []
    kept_locals: set[str] = set()
    for provider in entry.providers:
        missing = sorted(set(provider.references) & unresolved)
        if missing:
            todos.append(
                f"// REJOX-TODO(ENTRY_PROVIDER): <{provider.tag}> wrapped the app in "
                f"{entry.file} but {', '.join(missing)} could not be carried over; "
                f"re-add it here."
            )
            continue
        providers.append(provider)
        kept_locals.update(provider.references)

    # Group the kept bindings back into one import per module, preserving the
    # order the entry file declared them in.
    by_module: dict[str, dict[str, list[str]]] = {}
    order: list[str] = []
    declarations: list[str] = []
    for b in entry.bindings:
        if b.local not in kept_locals:
            continue
        if b.declaration is not None:
            declarations.append(b.declaration)
            continue
        specifier = binding_specifier.get(b.local)
        if specifier is None:
            continue
        if specifier not in by_module:
            by_module[specifier] = {"default": [], "named": []}
            order.append(specifier)
        slot = "default" if b.imported == "default" else "named"
        name = b.local if slot == "default" else (
            b.local if b.imported == b.local else f"{b.imported} as {b.local}"
        )
        by_module[specifier][slot].append(name)

    imports: list[str] = []
    for specifier in order:
        parts = by_module[specifier]
        clauses: list[str] = []
        if parts["default"]:
            clauses.append(parts["default"][0])
        if parts["named"]:
            clauses.append("{ " + ", ".join(sorted(set(parts["named"]))) + " }")
        imports.append(f'import {", ".join(clauses)} from "{specifier}";')

    return imports, declarations, providers, todos


def _provider_packages(entry: Optional[EntryPoint]) -> tuple[str, ...]:
    """External packages the lifted provider chain imports from."""
    if entry is None:
        return ()
    lifted = {ref for p in entry.providers for ref in p.references}
    return tuple(sorted({
        b.module
        for b in entry.bindings
        if b.local in lifted and b.module and b.resolvedFile is None
        and not b.module.startswith(".")
    }))


def _wrap_in_providers(element: str, providers: list[RootProvider]) -> str:
    """Nest ``element`` inside the provider chain, outermost provider first."""
    if not providers:
        return f"    {element}\n"
    lines: list[str] = []
    indent = "    "
    for provider in providers:
        attrs = ("".join(f" {a}" for a in provider.attributes))
        lines.append(f"{indent}<{provider.tag}{attrs}>")
        indent += "  "
    lines.append(f"{indent}{element}")
    for provider in reversed(providers):
        indent = indent[:-2]
        lines.append(f"{indent}</{provider.tag}>")
    return "\n".join(lines) + "\n"


def _app_source(
    *,
    nativewind: bool,
    app_name: str,
    navigator: bool,
    root_module: Optional[str],
    entry: Optional[EntryPoint],
    emitted_paths: set[str],
    available_packages: set[str],
) -> str:
    """Generate the root ``App.tsx``.

    It renders exactly one thing — the generated navigator, or the project's own
    converted root component (``root_module``) — wrapped in whatever providers
    the web entry file configured above it. Only a project that has neither (no
    router AND no readable root component) falls back to the placeholder, and
    that fallback is a genuinely empty project, not a lost one.
    """
    imports, declarations, providers, todos = _entry_imports(
        entry, emitted_paths, available_packages
    )

    head: list[str] = []
    if nativewind:
        head.append('import "./global.css";')

    if navigator:
        head.append("import { AppNavigator } from './src/navigation/AppNavigator';")
        element = "<AppNavigator />"
    elif root_module is not None:
        head.append(f'import AppRoot from "{root_module}";')
        element = "<AppRoot />"
    else:
        head.append("import { Text, View } from 'react-native';")
        element = None

    head.extend(imports)
    body = "\n".join(head) + "\n"
    if todos:
        body += "\n" + "\n".join(todos) + "\n"
    if declarations:
        body += "\n" + "\n".join(declarations) + "\n"

    if element is None:
        inner = (
            '    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>\n'
            f"      <Text>{app_name}</Text>\n"
            "    </View>\n"
        )
    else:
        inner = _wrap_in_providers(element, providers)

    return body + "\nexport default function App() {\n  return (\n" + inner + "  );\n}\n"


# --- Emission ----------------------------------------------------------------


def emit_project(
    plan: MigrationPlan,
    answers: dict[str, str],
    kg: KnowledgeGraph,
    out_dir: Path | str,
    *,
    report: Optional[AnalysisReport] = None,
    source_root: Optional[Path | str] = None,
    provider: Optional[LLMProvider] = None,
    cache: Optional[ResolutionCache] = None,
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
        provider: LLM provider for the AI Resolution Engine's rare LLM tier
            (styling novel classes). ``None`` → constructed lazily only if reached.
        cache: shared resolution cache across the batch.
    """
    report = report or analyze_graph(kg)
    src_root = Path(source_root or kg.project.root)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = cache or ResolutionCache()
    resolution_tiers: Counter = Counter()
    styling_options = {"stylingEngine": answers.get("styling-engine", "nativewind")}

    styling = answers.get("styling-engine", "stylesheet")
    nativewind = styling == "nativewind"
    app_name = kg.project.name.replace("-", " ").title()

    # A router-less project's src/App is its real UI, not router wiring: only a
    # generated navigator can subsume it. The entry file (src/main) is never
    # emitted either way — mounting into a DOM node has no RN equivalent — but
    # what it configured above the root component is lifted into App.tsx.
    has_navigator = bool(report.routing.library and report.routing.routes)
    regenerated = _regenerated_source_paths(kg)
    entry_source_file = regenerated.get("src/main")
    regenerated_paths = {p for stem, p in regenerated.items()
                         if stem == "src/main" or has_navigator}
    # Falls back to the .tsx literal only if no App file was found at all —
    # can't happen once report.routing required one, but keeps this total.
    app_source_file = regenerated.get("src/App", "src/App.tsx")

    # 1. scaffold.
    # A provider lifted out of the entry file imports its package; carrying the
    # provider without carrying that package emits an unresolvable import.
    scaffold = generate_scaffold(
        out_dir, answers, kg.project.dependencies, app_name,
        extra_packages=_provider_packages(kg.entry),
    )
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

    # 2. transform every source .ts/.tsx/.js/.jsx (except regenerated entry files).
    source_ts = sorted(
        f.path
        for f in kg.files
        if f.path.startswith("src/")
        and f.path.endswith(_SOURCE_EXTENSIONS)
        and f.path not in regenerated_paths
    )
    for src_rel in source_ts:
        never = _never_migrate(src_rel)
        if never is not None:
            skipped.append(SkippedFile(path=src_rel, reason=never))
            continue
        abs_src = src_root / src_rel
        if not abs_src.is_file():
            skipped.append(SkippedFile(path=src_rel, reason="source file not found on disk"))
            continue
        # One file's transform is isolated from the rest of the migration: an
        # edge case the codemod-worker cannot safely handle (rare — it already
        # refuses to emit code it cannot prove is syntactically valid) must not
        # take down every other file that transforms cleanly.
        try:
            result = transform_component(abs_src, options)
        except TransformerError as exc:
            skipped.append(
                SkippedFile(path=src_rel, reason=f"transform failed, left out of the migration: {exc}")
            )
            continue

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

        # AI Resolution Engine: resolve + APPLY this file's residue (CSS Module →
        # StyleSheet, hover/grid/… → NativeWind, isActive → static). Only what is
        # genuinely unresolvable keeps a REJOX-TODO; provenance follows the tier.
        provenance = _provenance(result)
        remaining_unhandled = list(result.unhandled)
        if result.unhandled:
            outcome = apply_resolutions(
                target, abs_src,
                unhandled=result.unhandled,
                component=Path(target_rel).stem,
                source_file=src_rel,
                options=styling_options,
                provider=provider,
                cache=cache,
            )
            resolution_tiers.update(outcome.tiers)
            remaining_unhandled = [u for u in result.unhandled if u.code in outcome.remainingCodes]
            if remaining_unhandled:
                provenance = ConfidenceSource.UNHANDLED
            elif result.warnings:
                # Residue resolved by rule, but the file still carries a
                # deterministic warning (flex-row/image-size) → worth review.
                provenance = ConfidenceSource.DETERMINISTIC_WARNING
            else:
                # Every residue re-expressed by rule, no warnings → as clean as
                # the transformer's own deterministic output.
                provenance = ConfidenceSource.DETERMINISTIC

        files.append(
            EmittedFile(
                path=target_rel,
                sourceFile=src_rel,
                provenance=provenance,
                warnings=result.warnings,
                unhandled=remaining_unhandled,
                todoCodes=_todo_codes(target.read_text()),
            )
        )

    # 3. navigator + App.tsx.
    if has_navigator:
        nav_shape = answers.get("navigator-shape", "stack")
        # Import each screen from where it was actually written, not from the
        # directory a screen is assumed to live in.
        nav_src, nav_todos = _navigator_source(
            report.routing.routes,
            nav_shape,
            _screen_import_paths(kg, {f.path for f in files}),
        )
        nav_rel = "src/navigation/AppNavigator.tsx"
        nav_path = out_dir / nav_rel
        nav_path.parent.mkdir(parents=True, exist_ok=True)
        nav_path.write_text(nav_src)
        files.append(
            EmittedFile(
                path=nav_rel,
                sourceFile=app_source_file,
                # Navigator wiring is a rule (generated from the route table);
                # the SHAPE decision lives in the Planner question, not here.
                provenance=ConfidenceSource.DETERMINISTIC_WARNING,
                unhandled=[],
                todoCodes=nav_todos,  # [] — no NAV_CONTAINER TODO survives
            )
        )

    emitted_paths = {f.path for f in files}
    # Without a navigator the root App is a converted file like any other; point
    # the generated shell at where it actually landed rather than assume it.
    root_target = _target_rel(app_source_file) if app_source_file else None
    root_module = (
        _module_specifier("App.tsx", root_target)
        if not has_navigator and root_target in emitted_paths
        else None
    )
    app_src = _app_source(
        nativewind=nativewind,
        app_name=app_name,
        navigator=has_navigator,
        root_module=root_module,
        entry=kg.entry,
        emitted_paths=emitted_paths,
        available_packages=set(scaffold.dependencies),
    )
    (out_dir / "App.tsx").write_text(app_src)
    # App.tsx is in the scaffold list already; refresh its provenance/source.
    # It is sourced from whatever it actually carries: the entry file when that
    # file's providers were lifted into it, else the App it wires.
    lifted_from_entry = bool(kg.entry and kg.entry.providers and "REJOX-TODO" not in app_src)
    files = [f for f in files if f.path != "App.tsx"]
    files.append(
        EmittedFile(
            path="App.tsx",
            sourceFile=(entry_source_file if lifted_from_entry else app_source_file),
            provenance=ConfidenceSource.DETERMINISTIC_WARNING,
            todoCodes=_todo_codes(app_src),
        )
    )

    # The entry file is deliberately never emitted — record it, so no source
    # file simply vanishes from the migration's accounting.
    if entry_source_file:
        lifted = len(kg.entry.providers) if kg.entry else 0
        skipped.append(SkippedFile(
            path=entry_source_file,
            reason=(
                "web entry point (mounting into a DOM node has no RN equivalent); "
                + (f"its {lifted} root provider(s) were lifted into App.tsx"
                   if lifted else "it wrapped no app-level providers")
            ),
        ))

    # 4. assets — copy real assets, skip web-only ones with a note.
    for asset in kg.assets:
        never = _never_migrate(asset.path)
        if never is not None:
            skipped.append(SkippedFile(path=asset.path, reason=never))
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

    # Note every remaining web-only file the project carries but we never emit
    # (HTML entry, global CSS, …) — driven by the same list, so a new kind of
    # web-only file is reported here the moment it is recognised above.
    already = {s.path for s in skipped} | {f.path for f in files}
    for f in kg.files:
        if f.path in already:
            continue
        never = _never_migrate(f.path)
        if never is not None:
            skipped.append(SkippedFile(path=f.path, reason=never))

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
