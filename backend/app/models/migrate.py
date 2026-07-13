"""Migrate endpoint schema — the full Migration Engine result.

``POST /api/migrate`` runs the whole back half of the pipeline: emit the React
Native project, validate it (tsc + Metro), and map every diagnostic back to the
transform that produced it. The response bundles everything the UI and the
(future) AI Resolution Engine need.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.analysis import AnalysisReport
from app.models.emission import EmittedProject
from app.models.plan import MigrationPlan
from app.models.validation import (
    MappedDiagnostic,
    ValidatedScores,
    ValidationResult,
)


class MigrateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report: AnalysisReport
    plan: MigrationPlan
    emission: EmittedProject
    validation: ValidationResult
    mappedDiagnostics: list[MappedDiagnostic] = Field(default_factory=list)
    validatedScores: Optional[ValidatedScores] = None
