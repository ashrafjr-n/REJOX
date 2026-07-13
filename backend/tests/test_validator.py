"""Integration tests for the Validator (``app/pipeline/validator.py``).

These run the FULL emit → npm install → tsc → Metro pipeline on sample-app, so
they are marked ``slow`` and excluded from the fast suite:

    pytest -m "not slow"      # fast: skips this file
    pytest -m slow            # runs the real toolchain

The gate assertion — ``unexplained_diagnostics == []`` — is the whole point:
every remaining tsc/Metro error must map to a known REJOX-TODO residue code.
A NEW unexplained error means a codemod regression, and this test fails loudly.

To keep repeat runs cheap, the project is emitted into a stable per-user temp
dir so ``node_modules`` is cached across runs (the Validator skips install when
it already exists).
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

import pytest

from app.models.knowledge_graph import KnowledgeGraph
from app.pipeline.analyzer import analyze_graph
from app.pipeline.emit import emit_project
from app.pipeline.planner import plan_migration
from app.pipeline.validator import (
    map_diagnostics,
    unexplained_diagnostics,
    validate_project,
    validated_scores,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = REPO_ROOT / "test-projects" / "sample-app"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
ANSWERS = {
    "project-type": "expo",
    "styling-engine": "nativewind",
    "navigation-library": "react-navigation",
}
# Residue codes the AI Resolution Engine owns — the ONLY explanations allowed
# for a remaining diagnostic on the benchmark.
KNOWN_RESIDUE = {
    "NAV_CONTAINER", "NAV_ACTIVE", "NAV_LINK", "NAV_HOOK", "CSS_MODULE",
    "TW_UNSUPPORTED", "IMAGE_SIZE", "FLEX_ROW_MADE_EXPLICIT", "EVENT_ADAPTER",
    "FORM_SUBMIT", "PROPS_HTML_TYPE", "WEB_ONLY_ELEMENT",
}

pytestmark = pytest.mark.slow


def _tools_available() -> bool:
    return bool(shutil.which("node") and shutil.which("npm"))


@pytest.fixture(scope="module")
def validated():
    if not _tools_available():
        pytest.skip("node/npm not on PATH; skipping the Validator integration test.")

    kg = KnowledgeGraph.model_validate(
        json.loads((FIXTURES / "sample-app.kg.json").read_text())
    )
    report = analyze_graph(kg)
    plan = plan_migration(report, kg)

    out = Path(tempfile.gettempdir()) / "rejox-validator-it"
    out.mkdir(parents=True, exist_ok=True)
    emitted = emit_project(plan, ANSWERS, kg, out, report=report, source_root=SRC_ROOT)
    result = validate_project(out, install=True, run_bundle=True)
    mapped = map_diagnostics(result, emitted, source_root=SRC_ROOT)
    scores = validated_scores(
        emitted, result,
        predicted_coverage=report.coverage,
        predicted_confidence=report.confidence,
    )
    return report, emitted, result, mapped, scores


def test_typecheck_ran_and_installed(validated) -> None:
    _, _, result, _, _ = validated
    assert result.installed is True
    assert result.typecheck.ran is True
    assert "typescript" in result.toolVersions


def test_diagnostics_parse_into_structured_form(validated) -> None:
    _, _, result, _, _ = validated
    # There ARE residue errors on the benchmark; each must be structured, not a
    # raw text blob.
    assert result.typecheck.errorCount > 0
    for d in result.typecheck.diagnostics:
        assert d.file and d.file.endswith((".ts", ".tsx"))
        assert d.line and d.line > 0
        assert d.code and d.code.startswith("TS")
        assert d.message


def test_every_remaining_diagnostic_maps_to_known_residue(validated) -> None:
    """THE GATE: zero unexplained errors."""
    _, _, _, mapped, _ = validated
    unexplained = unexplained_diagnostics(mapped)
    assert unexplained == [], (
        "Unexplained diagnostics (codemod bugs, not residue):\n"
        + "\n".join(
            f"  {m.file}:{m.diagnostic.line} {m.diagnostic.code} {m.diagnostic.message}"
            for m in unexplained
        )
    )
    # And every mapped error's residue codes are from the known residue set.
    for m in mapped:
        if m.diagnostic.severity != "error":
            continue
        assert m.nearbyTodo, f"{m.file}:{m.diagnostic.line} has no residue attribution"
        assert set(m.nearbyTodo) & KNOWN_RESIDUE, (
            f"{m.file}:{m.diagnostic.line} residue {m.nearbyTodo} not in KNOWN_RESIDUE"
        )


def test_mapped_diagnostics_carry_the_ai_contract(validated) -> None:
    _, _, _, mapped, _ = validated
    # Each mapped diagnostic is the AI Resolution Engine's payload: provenance +
    # source file + the offending snippet.
    for m in mapped:
        assert m.provenance is not None or m.diagnostic.source == "bundle"
        if m.diagnostic.file and m.diagnostic.line:
            assert m.sourceSnippet is not None


def test_confidence_matches_analyzer_prediction(validated) -> None:
    report, _, _, _, scores = validated
    # Confidence is provenance-based on both sides → should be tightly calibrated.
    assert abs(scores.confidence - report.confidence) <= 5.0
    # No non-residue file failed validation (no codemod bug).
    assert scores.failedUnits == []
