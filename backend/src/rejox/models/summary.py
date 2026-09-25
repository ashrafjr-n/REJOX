"""The outcome of one ``rejox migrate`` run, as ``--json`` prints it.

A script or CI job reads this instead of scraping the rendered report. Scores
keep the pipeline's rule: ``None`` means nothing was measured, never 0 or 100.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from rejox.models.analysis import RiskLevel
from rejox.models.validation import ValidatedScores, ValidationResult


class ResidueItem(BaseModel):
    file: str
    code: str


class LlmUsage(BaseModel):
    provider: str
    calls: int
    tokensIn: int
    tokensOut: int


class MigrationSummary(BaseModel):
    rejoxVersion: str
    exitCode: int
    project: str
    output: str
    answers: dict[str, str]
    # The Analyzer's static prediction, before anything was emitted.
    predictedCoverage: float
    predictedConfidence: Optional[float]
    risk: RiskLevel
    filesConverted: int
    filesSkipped: int
    todoCount: int
    residue: list[ResidueItem]
    # None when validation was skipped (--no-validate) or could not run.
    validation: Optional[ValidationResult]
    scores: Optional[ValidatedScores]
    llm: LlmUsage
