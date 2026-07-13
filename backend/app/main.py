"""Rejox AI — FastAPI application entrypoint.

Exposes the HTTP surface for the migration pipeline. For now this is just a
health check; pipeline routes will be added as the engine is built out.
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.models.analysis import AnalysisReport
from app.models.knowledge_graph import KnowledgeGraph
from app.models.plan import PlanResponse
from app.pipeline.analyzer import analyze_graph
from app.pipeline.intelligence import IntelligenceError, build_knowledge_graph
from app.pipeline.planner import plan_migration

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
