"""Tests for full-project emission (``app/pipeline/emit.py``).

These are fast: they emit the sample-app tree (each file through the real
codemod-worker) but do NOT install/validate — that is ``test_validator.py``.
They assert the ASSEMBLY is correct: tree shape, navigator generation, per-file
provenance, and that web-only assets are skipped.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.models.analysis import ConfidenceSource
from app.models.emission import EmittedProject
from app.models.knowledge_graph import KnowledgeGraph
from app.pipeline.analyzer import analyze_graph
from app.pipeline.emit import emit_project
from app.pipeline.planner import plan_migration
from app.pipeline.transformer import TransformerError

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = REPO_ROOT / "test-projects" / "sample-app"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
ANSWERS = {
    "project-type": "expo",
    "styling-engine": "nativewind",
    "navigation-library": "react-navigation",
}


@pytest.fixture(scope="module")
def emitted(tmp_path_factory: pytest.TempPathFactory) -> EmittedProject:
    kg = KnowledgeGraph.model_validate(
        json.loads((FIXTURES / "sample-app.kg.json").read_text())
    )
    report = analyze_graph(kg)
    plan = plan_migration(report, kg)
    out = tmp_path_factory.mktemp("emit")
    return emit_project(
        plan, ANSWERS, kg, out, report=report, source_root=SRC_ROOT
    )


def _out(emitted: EmittedProject) -> Path:
    return Path(emitted.outDir)


# --- Tree structure ----------------------------------------------------------


def test_pages_are_remapped_to_screens(emitted: EmittedProject) -> None:
    out = _out(emitted)
    # pages/ → screens/; components/ stays; both one level under src/.
    assert (out / "src" / "screens" / "ProductsPage.tsx").is_file()
    assert (out / "src" / "screens" / "ProductDetailPage.tsx").is_file()
    assert not (out / "src" / "pages").exists()
    assert (out / "src" / "components" / "Button.tsx").is_file()


def test_non_component_files_are_ported(emitted: EmittedProject) -> None:
    out = _out(emitted)
    # stores / api / hooks / types all routed through the codemod-worker.
    assert (out / "src" / "store" / "cartStore.ts").is_file()
    assert (out / "src" / "api" / "products.ts").is_file()
    assert (out / "src" / "hooks" / "useFetch.ts").is_file()
    assert (out / "src" / "lib" / "types.ts").is_file()


def test_navigator_generated_from_route_table(emitted: EmittedProject) -> None:
    out = _out(emitted)
    nav = out / "src" / "navigation" / "AppNavigator.tsx"
    assert nav.is_file()
    text = nav.read_text()
    # Screen names match the analyzer route table exactly, so the transformer's
    # navigation.navigate('Screen') calls resolve.
    for screen in ("Home", "Products", "ProductDetail", "Settings"):
        assert f'name="{screen}"' in text
    assert "createNativeStackNavigator" in text
    assert "NavigationContainer" in text
    # Navigator wiring is now a RULE (NAV_CONTAINER tier 2): a complete navigator
    # is generated from the route table, so NO NAV_CONTAINER TODO survives. The
    # navigator SHAPE decision is a Planner question, not code residue.
    assert "REJOX-TODO(NAV_CONTAINER)" not in text
    assert "REJOX-TODO" not in text


def test_navigator_matches_the_chosen_shape(tmp_path_factory) -> None:
    # When the user (or the tier-3 LLM) chooses `tabs`, the generator emits a
    # bottom-tab navigator — the chosen shape reaches the code.
    kg = KnowledgeGraph.model_validate(json.loads((FIXTURES / "sample-app.kg.json").read_text()))
    report = analyze_graph(kg)
    plan = plan_migration(report, kg)
    out = tmp_path_factory.mktemp("emit-tabs")
    answers = dict(ANSWERS, **{"navigator-shape": "tabs"})
    emit_project(plan, answers, kg, out, report=report, source_root=SRC_ROOT)
    nav = (out / "src" / "navigation" / "AppNavigator.tsx").read_text()
    assert "createBottomTabNavigator" in nav
    assert "createNativeStackNavigator" in nav  # the nested detail stack
    assert "ProductsNavigator" in nav           # ProductDetail nests under Products


def test_layout_shell_subsumed_by_navigator(emitted: EmittedProject) -> None:
    # The shared <Layout> (Outlet/Routes) is router structure → skipped, not
    # emitted as a dead <Outlet/> + TODO.
    out = _out(emitted)
    assert not (out / "src" / "components" / "Layout.tsx").exists()
    skipped = {s.path for s in emitted.skipped}
    assert "src/components/Layout.tsx" in skipped
    # And no emitted file carries a NAV_CONTAINER residue anymore.
    assert all("NAV_CONTAINER" not in f.todoCodes for f in emitted.files)


def test_app_wires_the_navigator(emitted: EmittedProject) -> None:
    out = _out(emitted)
    app = (out / "App.tsx").read_text()
    assert "AppNavigator" in app
    assert 'import "./global.css";' in app  # nativewind global styles wired


def test_report_written(emitted: EmittedProject) -> None:
    out = _out(emitted)
    report = out / "REJOX-REPORT.md"
    assert report.is_file()
    text = report.read_text()
    assert "Provenance (per file)" in text
    assert "ProductCard" in text


# --- Provenance --------------------------------------------------------------


def test_every_file_has_provenance(emitted: EmittedProject) -> None:
    assert emitted.files
    for f in emitted.files:
        assert isinstance(f.provenance, ConfidenceSource)


def test_resolvers_run_in_emit_and_clear_resolvable_residue(emitted: EmittedProject) -> None:
    by_path = {f.path: f for f in emitted.files}
    out = _out(emitted)

    # ProductCard's CSS Module + hover are now RESOLVED by the AI Resolution
    # Engine in emit: no CSS_MODULE/TW_UNSUPPORTED residue, the .module.css import
    # is gone (inlined as a StyleSheet), and provenance is rule-resolved.
    pc = by_path["src/components/ProductCard.tsx"]
    pc_codes = {u.code for u in pc.unhandled}
    assert "CSS_MODULE" not in pc_codes
    assert "TW_UNSUPPORTED" not in pc_codes
    assert pc.provenance != ConfidenceSource.UNHANDLED
    pc_text = (out / "src" / "components" / "ProductCard.tsx").read_text()
    assert ".module.css" not in pc_text
    assert "StyleSheet.create(" in pc_text

    # No .module.css file is emitted anywhere (that is what broke Metro).
    assert list(out.rglob("*.module.css")) == []

    # Navbar keeps ONLY genuinely-unresolvable residue: a runtime <Link to>.
    nav = by_path["src/components/Navbar.tsx"]
    nav_codes = {u.code for u in nav.unhandled}
    assert "NAV_ACTIVE" not in nav_codes      # resolved to a static className
    assert "TW_UNSUPPORTED" not in nav_codes  # hover/backdrop/… resolved
    assert nav_codes == {"NAV_LINK"}          # only the runtime link remains

    # A supported-only component (Footer) is clean deterministic.
    footer = by_path["src/components/Footer.tsx"]
    assert footer.provenance in (
        ConfidenceSource.DETERMINISTIC,
        ConfidenceSource.DETERMINISTIC_WARNING,
    )
    assert footer.unhandled == []


# --- Assets ------------------------------------------------------------------


def test_web_only_assets_skipped(emitted: EmittedProject) -> None:
    out = _out(emitted)
    reasons = {s.path: s.reason for s in emitted.skipped}
    assert "public/favicon.svg" in reasons
    assert "public/icons.svg" in reasons
    assert "index.html" in reasons
    # No favicon or web entry leaked into the RN tree.
    assert not (out / "public").exists()
    assert not (out / "index.html").exists()
    # The real asset is carried over.
    assert (out / "src" / "assets" / "rejox-logo.svg").is_file()


def test_no_asset_is_skipped_for_being_missing(emitted: EmittedProject) -> None:
    """A skip must be a DECISION, never a silent "the file wasn't there".

    Guards against the fixture drifting out of sync with the sample project on
    disk: a stale asset path would be skipped as "not found" and quietly pass
    the web-only assertions above for the wrong reason.
    """
    not_found = [s.path for s in emitted.skipped if "not found" in s.reason]
    assert not_found == []


def test_todo_count_matches_emitted_markers(emitted: EmittedProject) -> None:
    # todoCount is the ground-truth residue count from the emitted TODO markers.
    assert emitted.todoCount == sum(len(f.todoCodes) for f in emitted.files)
    assert emitted.todoCount > 0


# --- Plain JavaScript / .jsx sources -----------------------------------------
#
# sample-app above is 100% TypeScript, so it can never exercise the .js/.jsx
# path through emit_project — which is exactly how a real .jsx-only project
# (most React apps in the wild) was silently emitting an empty RN project:
# every source file fell outside the old `.endswith((".ts", ".tsx"))` filter
# and simply vanished, with no entry in `skipped` to explain why.

JS_SRC_ROOT = REPO_ROOT / "test-projects" / "plain-js-app"


@pytest.fixture(scope="module")
def emitted_js(tmp_path_factory: pytest.TempPathFactory) -> EmittedProject:
    from app.pipeline.intelligence import build_knowledge_graph

    kg = build_knowledge_graph(JS_SRC_ROOT)
    report = analyze_graph(kg)
    plan = plan_migration(report, kg)
    out = tmp_path_factory.mktemp("emit-js")
    return emit_project(
        plan, ANSWERS, kg, out, report=report, source_root=JS_SRC_ROOT
    )


def test_jsx_components_are_converted(emitted_js: EmittedProject) -> None:
    """The real regression: Header/Home/About are .jsx, not .tsx — before the
    fix these fell out of the file filter and were dropped without a trace."""
    converted = {f.sourceFile for f in emitted_js.files if f.sourceFile}
    assert "src/components/Header.jsx" in converted
    assert "src/pages/Home.jsx" in converted
    assert "src/pages/About.jsx" in converted


def test_jsx_target_extension_is_rewritten_to_tsx(emitted_js: EmittedProject) -> None:
    # tsconfig.json only includes **/*.ts and **/*.tsx (scaffold.py) — a .jsx
    # source emitted with its original extension would silently never be
    # type-checked at all.
    by_source = {f.sourceFile: f.path for f in emitted_js.files if f.sourceFile}
    assert by_source["src/components/Header.jsx"] == "src/components/Header.tsx"
    assert by_source["src/pages/Home.jsx"] == "src/screens/Home.tsx"
    assert by_source["src/pages/About.jsx"] == "src/screens/About.tsx"


def test_js_entry_files_are_not_duplicated(emitted_js: EmittedProject) -> None:
    """src/main.jsx and src/App.jsx are regenerated wholesale (navigator +
    App.tsx) — they must not ALSO run through the generic per-file loop and
    leak a second, stray copy into the output tree."""
    paths = [f.path for f in emitted_js.files]
    assert "src/main.jsx" not in paths
    assert "src/main.tsx" not in paths
    assert "src/App.jsx" not in paths
    assert paths.count("App.tsx") == 1


def test_navigator_imports_resolve_to_emitted_screens(emitted_js: EmittedProject) -> None:
    # The failure mode this bug produced end-to-end: AppNavigator.tsx imports
    # screens that were never written, so tsc/Metro fail on a dangling import.
    nav = (_out(emitted_js) / "src" / "navigation" / "AppNavigator.tsx").read_text()
    assert "../screens/Home" in nav
    assert "../screens/About" in nav
    assert (_out(emitted_js) / "src" / "screens" / "Home.tsx").is_file()
    assert (_out(emitted_js) / "src" / "screens" / "About.tsx").is_file()


def test_app_provenance_matches_the_real_source_extension(emitted_js: EmittedProject) -> None:
    # Previously hardcoded to the literal "src/App.tsx" regardless of the
    # project's real extension — wrong provenance for any .jsx project.
    app = next(f for f in emitted_js.files if f.path == "App.tsx")
    nav = next(f for f in emitted_js.files if f.path == "src/navigation/AppNavigator.tsx")
    assert app.sourceFile == "src/App.jsx"
    assert nav.sourceFile == "src/App.jsx"


def test_one_failing_transform_does_not_abort_the_whole_migration(
    tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A real .jsx repo hit a codemod-worker edge case (a JSX attribute string
    spanning a literal newline) that the worker correctly refused to emit —
    and that refusal, uncaught, took the ENTIRE migration down: every other
    file that transforms cleanly was lost too, with no partial output.

    One file the codemod-worker cannot safely handle must be isolated: skipped
    with a reason, not allowed to abort every other file's conversion.
    """
    from app.pipeline.intelligence import build_knowledge_graph
    import app.pipeline.emit as emit_module

    kg = build_knowledge_graph(JS_SRC_ROOT)
    report = analyze_graph(kg)
    plan = plan_migration(report, kg)

    real_transform = emit_module.transform_component

    def flaky_transform(file: Path, options: object = None) -> object:
        if str(file).endswith("Header.jsx"):
            raise TransformerError("simulated codemod-worker refusal for this test")
        return real_transform(file, options)

    monkeypatch.setattr(emit_module, "transform_component", flaky_transform)

    out = tmp_path_factory.mktemp("emit-js-flaky")
    emitted = emit_project(plan, ANSWERS, kg, out, report=report, source_root=JS_SRC_ROOT)

    failed = [s for s in emitted.skipped if s.path == "src/components/Header.jsx"]
    assert len(failed) == 1
    assert "transform failed" in failed[0].reason

    # The other files converted normally — the failure did not cascade.
    converted = {f.sourceFile for f in emitted.files if f.sourceFile}
    assert "src/pages/Home.jsx" in converted
    assert "src/pages/About.jsx" in converted
    assert "src/components/Header.jsx" not in converted


def test_routed_screen_outside_pages_is_imported_from_where_it_landed(
    emitted_js: EmittedProject,
) -> None:
    """A routed screen does not have to live under pages/.

    `NotFound` is routed but sits in src/components/. The navigator used to
    import every screen from '../screens/<name>' on the assumption that routed
    components live under pages/ — which wrote an import to a file that was
    never emitted there, and Metro failed to resolve it. A real repo
    (Hotel-Booking-Landing-Page) hit exactly this with its PageNotFound.
    """
    nav = (_out(emitted_js) / "src" / "navigation" / "AppNavigator.tsx").read_text()
    assert "from '../components/NotFound'" in nav
    assert "from '../screens/NotFound'" not in nav
    # The file really is where the import points.
    assert (_out(emitted_js) / "src" / "components" / "NotFound.tsx").is_file()
    # Screens that DO live under pages/ still resolve to screens/.
    assert "from '../screens/Home'" in nav


def test_web_only_and_build_only_files_never_reach_the_rn_project(
    emitted_js: EmittedProject,
) -> None:
    """One list, three classes that must never be migrated.

    `vite-env.d.ts` reached a real migrated project because the exclusion rules
    were scattered per-loop instead of stated once: it references `vite/client`
    types the RN project does not have. Test files are the same category — the
    runtime app does not include them, and @testing-library/react has no RN
    equivalent, so copying them guarantees a broken type-check.
    """
    reasons = {s.path: s.reason for s in emitted_js.skipped}
    emitted_paths = {f.path for f in emitted_js.files}

    assert "src/vite-env.d.ts" in reasons
    assert "bundler types" in reasons["src/vite-env.d.ts"]
    assert "src/App.test.jsx" in reasons
    assert "test file" in reasons["src/App.test.jsx"]
    assert "index.html" in reasons

    # And none of them landed in the tree under any name.
    assert not any("vite-env" in p or ".test." in p for p in emitted_paths)


# --- Router-less projects: the root component and its providers --------------

NO_ROUTER_SRC_ROOT = REPO_ROOT / "test-projects" / "no-router-app"


@pytest.fixture(scope="module")
def emitted_no_router(tmp_path_factory: pytest.TempPathFactory) -> EmittedProject:
    from app.pipeline.intelligence import build_knowledge_graph

    kg = build_knowledge_graph(NO_ROUTER_SRC_ROOT)
    report = analyze_graph(kg)
    plan = plan_migration(report, kg)
    out = tmp_path_factory.mktemp("emit-no-router")
    return emit_project(
        plan, ANSWERS, kg, out, report=report, source_root=NO_ROUTER_SRC_ROOT
    )


def test_router_less_root_component_is_converted_not_replaced(
    emitted_no_router: EmittedProject,
) -> None:
    """The regression: with no router to subsume it, ``src/App.jsx`` was
    regenerated as a placeholder — so the project's entire UI (and every
    component it rendered) was emitted but never reachable, while the report
    still claimed App.tsx came from src/App.jsx."""
    out = _out(emitted_no_router)
    converted = {f.sourceFile for f in emitted_no_router.files if f.sourceFile}
    assert "src/App.jsx" in converted

    root = (out / "src" / "App.tsx").read_text()
    # It is the real component, converted — not a stub.
    assert "Header" in root and "Counter" in root
    assert "<View" in root  # <main>/<div> converted by rule


def test_router_less_app_shell_renders_the_converted_root(
    emitted_no_router: EmittedProject,
) -> None:
    app = (_out(emitted_no_router) / "App.tsx").read_text()
    assert './src/App' in app
    assert "<AppRoot />" in app
    assert "scaffold ready" not in app


def test_entry_providers_are_lifted_into_the_app_root(
    emitted_no_router: EmittedProject,
) -> None:
    """main.jsx is never emitted, so the <Provider store={store}> it wrapped the
    app in has to be rebuilt above the RN root — otherwise every hook that reads
    the store throws at runtime."""
    app = (_out(emitted_no_router) / "App.tsx").read_text()
    assert "<Provider store={store}>" in app
    assert 'from "react-redux"' in app
    # Imported from where the store actually landed, not a guessed path.
    assert 'from "./src/services/store"' in app
    assert (_out(emitted_no_router) / "src" / "services" / "store.ts").is_file()


def test_stateless_and_router_wrappers_are_not_lifted(
    emitted_no_router: EmittedProject,
) -> None:
    app = (_out(emitted_no_router) / "App.tsx").read_text()
    assert "StrictMode" not in app


def test_entry_file_is_accounted_for_as_skipped(
    emitted_no_router: EmittedProject,
) -> None:
    """A source file must never simply vanish from the migration's accounting:
    src/main.jsx is deliberately not emitted, so it has to appear as skipped
    with the reason — and say what was lifted out of it."""
    skipped = {s.path: s.reason for s in emitted_no_router.skipped}
    assert "src/main.jsx" in skipped
    assert "lifted into App.tsx" in skipped["src/main.jsx"]


def test_routed_project_still_wires_the_navigator(emitted_js: EmittedProject) -> None:
    """The router-less path must not change the routed one: there, src/App is
    router wiring and the generated navigator does subsume it."""
    app = (_out(emitted_js) / "App.tsx").read_text()
    assert "<AppNavigator />" in app
    converted = {f.sourceFile for f in emitted_js.files if f.sourceFile}
    assert "src/App.jsx" not in [f.path for f in emitted_js.files]
    assert "src/main.jsx" in {s.path for s in emitted_js.skipped}
    del converted


def test_provider_is_dropped_when_its_package_was_not_installed(
    tmp_path_factory: pytest.TempPathFactory,
) -> None:
    """The scaffold drops a dependency whose version spec is not a plain
    registry range (the A9 carry-over filter). Lifting a provider whose package
    was dropped that way would emit an import of something deliberately never
    installed — so the provider is dropped too, and says so."""
    import json as _json
    import shutil

    from app.pipeline.intelligence import build_knowledge_graph

    src = tmp_path_factory.mktemp("hostile") / "app"
    shutil.copytree(NO_ROUTER_SRC_ROOT, src)
    pkg = src / "package.json"
    data = _json.loads(pkg.read_text())
    data["dependencies"]["react-redux"] = "https://evil.example.com/pkg.tgz"
    pkg.write_text(_json.dumps(data))

    kg = build_knowledge_graph(src)
    report = analyze_graph(kg)
    plan = plan_migration(report, kg)
    out = tmp_path_factory.mktemp("emit-hostile")
    emit_project(plan, ANSWERS, kg, out, report=report, source_root=src)

    app = (out / "App.tsx").read_text()
    assert "react-redux" not in app                  # no dangling import
    assert "<Provider store={store}>" not in app     # not in the rendered tree
    assert "REJOX-TODO(ENTRY_PROVIDER)" in app       # and never silently
