"""Rejox AI — FastAPI application entrypoint.

Exposes the HTTP surface for the migration pipeline. For now this is just a
health check; pipeline routes will be added as the engine is built out.
"""

import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.models.analysis import AnalysisReport
from app.models.knowledge_graph import KnowledgeGraph
from app.models.migrate import MigrateResponse
from app.models.plan import PlanResponse
from app.pipeline.analyzer import analyze_graph
from app.pipeline.emit import emit_project
from app.pipeline.intelligence import IntelligenceError, build_knowledge_graph
from app.pipeline.planner import plan_migration
from app.pipeline.validator import (
    ValidatorError,
    map_diagnostics,
    validate_project,
    validated_scores,
)

app = FastAPI(
    title="Rejox AI",
    description="AI migration engineer: React → React Native.",
    version="0.1.0",
)


class HealthResponse(BaseModel):
    """Response schema for the health check endpoint."""

    status: str


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness probe. Returns ``{"status": "ok"}`` when the app is up."""
    return HealthResponse(status="ok")


class ParseRequest(BaseModel):
    """Request body for the parse endpoint.

    For dev this accepts a local filesystem path; ZIP/upload handling arrives
    with the Upload stage.
    """

    path: str = Field(..., description="Local path to a React project root.")


@app.post("/api/parse", response_model=KnowledgeGraph)
def parse(req: ParseRequest) -> KnowledgeGraph:
    """Parse stage: run the Node worker and return the Knowledge Graph JSON."""
    try:
        return build_knowledge_graph(Path(req.path))
    except IntelligenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/analyze", response_model=AnalysisReport)
def analyze(req: ParseRequest) -> AnalysisReport:
    """Analysis stage: parse the project, then analyze migratability."""
    try:
        kg = build_knowledge_graph(Path(req.path))
    except IntelligenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return analyze_graph(kg)


@app.post("/api/plan", response_model=PlanResponse)
def plan(req: ParseRequest) -> PlanResponse:
    """Plan stage: parse + analyze + plan; returns the report and plan together."""
    try:
        kg = build_knowledge_graph(Path(req.path))
    except IntelligenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    report = analyze_graph(kg)
    migration_plan = plan_migration(report, kg)
    return PlanResponse(report=report, plan=migration_plan)


class MigrateRequest(BaseModel):
    """Request body for the migrate endpoint."""

    path: str = Field(..., description="Local path to a React project root.")
    answers: dict[str, str] = Field(
        default_factory=dict,
        description="Ask-stage answers, e.g. {'styling-engine': 'nativewind'}.",
    )
    outDir: Optional[str] = Field(
        default=None,
        description="Where to emit the RN project; a temp dir is used if omitted.",
    )
    install: bool = Field(True, description="Run npm install (cached across runs).")
    runBundle: bool = Field(True, description="Run the Metro bundle (slowest stage).")


@app.post("/api/migrate", response_model=MigrateResponse)
def migrate(req: MigrateRequest) -> MigrateResponse:
    """Migrate stage: emit the RN project, validate it, and map diagnostics.

    Runs the whole back half of the pipeline deterministically (no LLM). The
    ``mappedDiagnostics`` payload is exactly what the AI Resolution Engine will
    consume as its repair loop.
    """
    source = Path(req.path)
    try:
        kg = build_knowledge_graph(source)
    except IntelligenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    report = analyze_graph(kg)
    plan = plan_migration(report, kg)

    out_dir = Path(req.outDir) if req.outDir else Path(tempfile.mkdtemp(prefix="rejox-"))
    emission = emit_project(
        plan, req.answers, kg, out_dir, report=report, source_root=source
    )

    try:
        validation = validate_project(
            out_dir, install=req.install, run_bundle=req.runBundle
        )
    except ValidatorError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    mapped = map_diagnostics(validation, emission, source_root=source)
    scores = validated_scores(
        emission,
        validation,
        predicted_coverage=report.coverage,
        predicted_confidence=report.confidence,
    )
    return MigrateResponse(
        report=report,
        plan=plan,
        emission=emission,
        validation=validation,
        mappedDiagnostics=mapped,
        validatedScores=scores,
    )
