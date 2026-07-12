"""Rejox AI — FastAPI application entrypoint.

Exposes the HTTP surface for the migration pipeline. For now this is just a
health check; pipeline routes will be added as the engine is built out.
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.models.knowledge_graph import KnowledgeGraph
from app.pipeline.parser import ParserError, parse_project

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
        return parse_project(Path(req.path))
    except ParserError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
