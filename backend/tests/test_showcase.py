"""Showcase export — integration test.

The committed ``frontend/src/data/showcase.json`` powers a marketing page that
must show REAL engine numbers. This test is the guard against that file going
stale or being hand-edited: it proves the committed file equals what a live
pipeline run produces, and that the export is byte-deterministic.

Marked ``slow`` (real npm install + tsc + Metro), so it is excluded from the
fast suite (``pytest -m "not slow"``).
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from app import cli
from app.cli import (
    _CountingProvider,
    _CORE_QUESTION_IDS,
    _ask_navigator_shape,
    _make_provider,
    _nav_ui_summary,
    _recommended,
    app,
)
from app.pipeline.analyzer import analyze_graph
from app.pipeline.emit import emit_project
from app.pipeline.intelligence import build_knowledge_graph
from app.pipeline.planner import plan_migration
from app.pipeline.validator import validate_project, validated_scores

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE = REPO_ROOT / "test-projects" / "sample-app"
COMMITTED = REPO_ROOT / "frontend" / "src" / "data" / "showcase.json"

pytestmark = pytest.mark.slow
runner = CliRunner()


def _tools_available() -> bool:
    return bool(shutil.which("node") and shutil.which("npm"))


def _export(tmp_path: Path, name: str) -> str:
    out = tmp_path / name / "showcase.json"
    result = runner.invoke(app, ["export-showcase", "--out", str(out)])
    assert result.exit_code == 0, result.output
    return out.read_text(encoding="utf-8")


def test_export_is_byte_deterministic(tmp_path, monkeypatch) -> None:
    if not _tools_available():
        pytest.skip("node/npm not on PATH.")
    monkeypatch.delenv("SOURCE_DATE_EPOCH", raising=False)
    first = _export(tmp_path, "a")
    second = _export(tmp_path, "b")
    assert first == second  # two real runs, byte-for-byte identical


def test_committed_file_equals_a_fresh_run(tmp_path, monkeypatch) -> None:
    if not _tools_available():
        pytest.skip("node/npm not on PATH.")
    monkeypatch.delenv("SOURCE_DATE_EPOCH", raising=False)
    fresh = _export(tmp_path, "fresh")
    committed = COMMITTED.read_text(encoding="utf-8")
    assert fresh == committed, (
        "frontend/src/data/showcase.json is stale — re-run `rejox export-showcase`."
    )


def _live_run(monkeypatch):
    """An independent live pipeline run — the ground truth the exported file is
    checked against. Reuses the exact pipeline functions and CLI helpers the
    export command uses (no parallel implementation)."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("REJOX_AI_PROVIDER", "fake")

    kg = build_knowledge_graph(SAMPLE)
    report = analyze_graph(kg)
    plan = plan_migration(report, kg)

    inner, _ = _make_provider()
    counter = _CountingProvider(inner)
    answers: dict[str, str] = {}
    for qid in _CORE_QUESTION_IDS:
        q = next((x for x in plan.questions if x.id == qid), None)
        if q is not None:
            answers[qid] = _recommended(q) or ""
    shape_answer, proposal, _ = _ask_navigator_shape(report, kg, inner, counter, auto=True)
    answers["navigator-shape"] = shape_answer

    out = REPO_ROOT / "backend" / ".rejox-workspaces" / "showcase-it"
    if out.exists():
        shutil.rmtree(out)
    emission = emit_project(plan, answers, kg, out, report=report, source_root=SAMPLE)
    validation = validate_project(out, install=True, run_bundle=True)
    scores = validated_scores(
        emission, validation,
        predicted_coverage=report.coverage, predicted_confidence=report.confidence,
    )
    return report, scores, validation, counter


def test_exported_values_equal_the_live_engine(tmp_path, monkeypatch) -> None:
    if not _tools_available():
        pytest.skip("node/npm not on PATH.")
    report, scores, validation, counter = _live_run(monkeypatch)

    data = json.loads(COMMITTED.read_text(encoding="utf-8"))
    r = data["results"]

    # Validated coverage / confidence come from the post-validation scorer.
    assert r["validatedCoverage"] == scores.workingCoverage
    assert r["validatedStrictCoverage"] == scores.coverage
    assert r["validatedConfidence"] == scores.confidence
    # tsc + Metro verdicts.
    assert r["tscPassed"] == validation.typecheck.passed
    assert r["metroPassed"] == validation.bundle.passed
    assert r["metroRan"] == validation.bundle.ran
    # The thesis number: the single genuine reasoning call.
    assert r["llmCalls"] == counter.calls == 1
    # Predicted scores from the analyzer.
    assert r["predictedCoverage"] == report.coverage
    assert r["predictedConfidence"] == report.confidence
    # The signed contribution rows sum to the predicted coverage.
    contrib_sum = sum(c["delta"] for c in r["contributions"])
    assert abs(contrib_sum - r["predictedCoverage"]) < 0.05
    assert abs(contrib_sum - report.coverage) < 0.05
