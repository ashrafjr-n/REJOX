"""Tests for the one property every score in Rejox must have: an empty
population is never a perfect score.

Each case here is a shape that previously reported success for having measured
nothing — a migration that emitted no files reporting 100% coverage, an empty
directory scoring 95% migratable, a project where not one component can convert
reporting 100% confidence. They are grouped in one file because they are one
bug, not three: `x if population else 100`.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.models.analysis import ComponentFinding
from app.models.emission import EmittedProject
from app.models.knowledge_graph import KnowledgeGraph
from app.models.validation import StageResult, ValidationResult
from app.pipeline.analyzer import NothingToMigrate, analyze_graph
from app.pipeline.rules import scoring
from app.pipeline.validator import validated_scores

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _kg(**overrides) -> KnowledgeGraph:
    raw = json.loads((FIXTURES / "sample-app.kg.json").read_text())
    raw.update(overrides)
    return KnowledgeGraph.model_validate(raw)


# --- The Validator: nothing emitted is not 100% migrated ---------------------


def _empty_validation() -> ValidationResult:
    return ValidationResult(
        passed=True,
        installed=True,
        typecheck=StageResult(ran=True, passed=True),
        bundle=StageResult(ran=True, passed=True),
        durationSeconds=0.0,
    )


def test_emitting_nothing_is_not_full_coverage() -> None:
    """The exact failure this file exists for: a migration that wrote no units
    used to report Coverage 100% / Confidence 100% — a perfect score for having
    produced nothing at all."""
    emitted = EmittedProject(outDir="/tmp/none", files=[], skipped=[], todoCount=0)

    scores = validated_scores(emitted, _empty_validation())

    assert scores.totalUnitCount == 0
    assert scores.coverage is None
    assert scores.workingCoverage is None
    assert scores.confidence is None


def test_a_passing_validator_does_not_make_an_empty_migration_succeed() -> None:
    # tsc and Metro both pass trivially on a project with no source of ours in
    # it. That must not read as a validated migration.
    scores = validated_scores(
        EmittedProject(outDir="/tmp/none", files=[], skipped=[], todoCount=0),
        _empty_validation(),
    )
    assert scores.validatorPassed is True
    assert scores.coverage is None, "a trivially-passing validator is not coverage"


# --- The Analyzer: an empty graph is not a 95%-migratable project ------------


def test_a_graph_with_no_components_is_refused_not_scored() -> None:
    with pytest.raises(NothingToMigrate, match="No React components"):
        analyze_graph(_kg(components=[], files=[], routes=[]))


def test_the_refusal_names_what_was_expected() -> None:
    with pytest.raises(NothingToMigrate) as excinfo:
        analyze_graph(_kg(components=[], files=[], routes=[]))
    message = str(excinfo.value)
    # Actionable, not just a rejection: the caller learns what to check.
    assert ".jsx/.tsx" in message
    assert "components" in message


def test_a_real_graph_still_scores() -> None:
    report = analyze_graph(_kg())
    assert report.coverage > 0
    assert report.confidence is not None


# --- Confidence: nothing migrating is not certainty --------------------------


def _blocked(name: str) -> ComponentFinding:
    return ComponentFinding(
        componentId=name, name=name, file=f"src/{name}.tsx",
        score=0, difficulty="blocked", issues=[],
    )


def test_confidence_is_unmeasured_when_every_component_is_blocked() -> None:
    """Confidence is a mean over MIGRATED units. With every component blocked
    that population is empty — which used to fall back to 100, turning "not one
    component can be converted" into total certainty."""
    assert scoring.compute_confidence([_blocked("A"), _blocked("B")]) is None


def test_confidence_is_measured_as_soon_as_one_component_migrates() -> None:
    findings = [
        _blocked("Blocked"),
        ComponentFinding(
            componentId="Ok", name="Ok", file="src/Ok.tsx",
            score=100, difficulty="trivial", issues=[],
        ),
    ]
    assert scoring.compute_confidence(findings) == 100.0


def test_no_findings_at_all_is_unmeasured() -> None:
    assert scoring.compute_confidence([]) is None


# --- The "compiles + bundles" lens answers for the bundle too ----------------


def _one_unit_project() -> EmittedProject:
    from app.models.analysis import ConfidenceSource
    from app.models.emission import EmittedFile

    return EmittedProject(
        outDir="/tmp/one",
        files=[
            EmittedFile(
                path=f"src/components/C{i}.tsx",
                sourceFile=f"src/components/C{i}.jsx",
                provenance=ConfidenceSource.DETERMINISTIC,
            )
            for i in range(4)
        ],
        skipped=[],
        todoCount=0,
    )


def _validation(*, bundle_ran: bool, bundle_passed: bool) -> ValidationResult:
    return ValidationResult(
        passed=bundle_passed,
        installed=True,
        typecheck=StageResult(ran=True, passed=True),
        bundle=StageResult(ran=bundle_ran, passed=bundle_passed),
        durationSeconds=0.0,
    )


def test_a_failed_bundle_means_nothing_bundles() -> None:
    """The regression: Metro fails fast, so a failed bundle produces one
    diagnostic for one file and never reaches the rest. Counting the rest as
    "compiles + bundles" let a MORE broken migration score HIGHER — the
    summarizer went 33% -> 43% while Metro went PASS -> FAIL."""
    scores = validated_scores(
        _one_unit_project(), _validation(bundle_ran=True, bundle_passed=False)
    )
    assert scores.totalUnitCount == 4
    assert scores.workingCoverage == 0.0
    assert scores.workingFileCount == 0
    # The strict lens is unaffected — it measures residue, not the toolchain.
    assert scores.coverage == 100.0


def test_a_bundle_that_never_ran_is_not_measured() -> None:
    """A lens labelled "compiles + bundles" cannot answer when nothing was
    bundled. n/a, never a number carried over from the compiler alone."""
    scores = validated_scores(
        _one_unit_project(), _validation(bundle_ran=False, bundle_passed=False)
    )
    assert scores.workingCoverage is None
    assert scores.coverage == 100.0


def test_a_passing_bundle_still_measures_per_file() -> None:
    scores = validated_scores(
        _one_unit_project(), _validation(bundle_ran=True, bundle_passed=True)
    )
    assert scores.workingCoverage == 100.0
    assert scores.workingFileCount == 4
