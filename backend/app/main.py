"""Rejox AI — FastAPI application entrypoint.

Exposes the HTTP surface for the migration pipeline. For now this is just a
health check; pipeline routes will be added as the engine is built out.
"""

from fastapi import FastAPI
from pydantic import BaseModel

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
