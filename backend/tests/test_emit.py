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


def test_residue_files_carry_unhandled(emitted: EmittedProject) -> None:
    by_path = {f.path: f for f in emitted.files}
    # ProductCard has a CSS Module + hover → residue provenance + codes.
    pc = by_path["src/components/ProductCard.tsx"]
    assert pc.provenance == ConfidenceSource.UNHANDLED
    assert "CSS_MODULE" in {u.code for u in pc.unhandled}
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
    skipped = {s.path for s in emitted.skipped}
    assert "public/favicon.svg" in skipped
    assert "src/assets/vite.svg" in skipped
    assert "index.html" in skipped
    # No favicon or web entry leaked into the RN tree.
    assert not (out / "public").exists()
    assert not (out / "index.html").exists()
    # The real asset (hero.png) is carried over.
    assert (out / "src" / "assets" / "hero.png").is_file()


def test_todo_count_matches_emitted_markers(emitted: EmittedProject) -> None:
    # todoCount is the ground-truth residue count from the emitted TODO markers.
    assert emitted.todoCount == sum(len(f.todoCodes) for f in emitted.files)
    assert emitted.todoCount > 0
