"""Rejox AI — FastAPI application entrypoint.

Exposes the HTTP surface for the migration pipeline: the Upload stage
(``/api/upload`` for a ZIP, ``/api/upload/github`` for a public repo), the
analysis stages (``/api/parse|analyze|plan``), the Migration Engine
(``/api/migrate``), and the final Download stage
(``/api/runs/{runId}/download``).

Every stage after Upload accepts either a ``runId`` (a landed upload in its run
workspace) or a local ``path`` (dev/CLI convenience) — the same pipeline
functions run underneath, never over HTTP, never re-implemented.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Optional, TypeVar

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.background import BackgroundTask

from app import jobs
from app.models.analysis import AnalysisReport
from app.models.ingest import IngestedProject
from app.models.jobs import JobCreated, JobState
from app.models.knowledge_graph import KnowledgeGraph
from app.models.plan import MigrationPlan, PlanResponse
from app.pipeline import workspace
from app.pipeline.analyzer import AnalyzerError, analyze_graph
from app.pipeline.ingest import IngestError, ingest_github, ingest_zip
from app.pipeline.intelligence import IntelligenceError, build_knowledge_graph
from app.pipeline.planner import PlannerError, plan_migration

app = FastAPI(
    title="Rejox AI",
    description="AI migration engineer: React → React Native.",
    version="0.1.0",
)

# --- CORS --------------------------------------------------------------------
# The web frontend runs on its own origin (Vite dev server), so the browser
# needs the backend to opt those origins in explicitly. Origins are read from
# REJOX_CORS_ORIGINS (comma-separated); we never fall back to a wildcard.
_DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


def _cors_origins() -> list[str]:
    raw = os.environ.get("REJOX_CORS_ORIGINS", _DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Vendor/build dirs never belong in a downloaded RN project bundle.
_DOWNLOAD_SKIP = {"node_modules", ".rejox-bundle", ".expo", ".git"}


class HealthResponse(BaseModel):
    """Response schema for the health check endpoint."""

    status: str


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness probe. Returns ``{"status": "ok"}`` when the app is up."""
    return HealthResponse(status="ok")


# --- source resolution (runId OR local path) ---------------------------------


class SourceRequest(BaseModel):
    """A source project — either a landed upload (``runId``) or a local ``path``.

    ``root`` optionally selects one of the ingest's ``candidateRoots`` (a
    monorepo subdirectory, relative to the run's ``source/``); without it the
    detected root is used.
    """

    model_config = ConfigDict(extra="forbid")

    path: Optional[str] = Field(default=None, description="Local path to a React project root.")
    runId: Optional[str] = Field(default=None, description="A run id from a prior /api/upload.")
    root: Optional[str] = Field(default=None, description="Candidate root (relative) to use.")

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "SourceRequest":
        if bool(self.path) == bool(self.runId):
            raise ValueError("Provide exactly one of 'path' or 'runId'.")
        return self


def _source_for(req: SourceRequest) -> Path:
    """Resolve the request to the React project directory to run against."""
    if req.path:
        return Path(req.path)
    run = _get_run_or_404(req.runId)  # type: ignore[arg-type]
    if not run.manifest_path.is_file():
        raise HTTPException(status_code=409, detail=f"Run {run.runId} has no ingested project.")
    ingested = IngestedProject.model_validate_json(run.manifest_path.read_text())
    if req.root:
        chosen = next((c for c in ingested.candidateRoots if c.path == req.root), None)
        if chosen is None:
            raise HTTPException(status_code=400, detail=f"Unknown candidate root: {req.root!r}.")
        return (run.source_dir / chosen.path).resolve()
    return Path(ingested.detectedRoot)


def _get_run_or_404(run_id: str) -> workspace.Run:
    try:
        return workspace.get_run(run_id)
    except workspace.WorkspaceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _build_kg(source: Path) -> KnowledgeGraph:
    try:
        return build_knowledge_graph(source)
    except IntelligenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# The Analyzer and Planner are deterministic and total over a valid graph, so a
# failure there is OUR defect, not a bad upload: it stays a 500 (never a 4xx
# that would blame the user's project), but carries the stage's typed message
# instead of FastAPI's opaque "Internal Server Error".
def _analyze(kg: KnowledgeGraph) -> AnalysisReport:
    try:
        return analyze_graph(kg)
    except AnalyzerError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _plan(report: AnalysisReport, kg: KnowledgeGraph) -> MigrationPlan:
    try:
        return plan_migration(report, kg)
    except PlannerError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# --- Upload stage ------------------------------------------------------------


@app.post("/api/upload", response_model=IngestedProject)
async def upload(file: UploadFile = File(...)) -> IngestedProject:
    """Upload stage: land a ZIP into a fresh run workspace and detect the root."""
    run = workspace.new_run()
    try:
        data = await file.read()
        return ingest_zip(data, run)
    except IngestError as exc:
        workspace.cleanup(run.runId)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        workspace.cleanup(run.runId)
        raise


class GithubUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(..., description="Public GitHub repo URL.")
    ref: Optional[str] = Field(default=None, description="Optional branch/tag to clone.")


@app.post("/api/upload/github", response_model=IngestedProject)
def upload_github(req: GithubUploadRequest) -> IngestedProject:
    """Upload stage: shallow-clone a public GitHub repo into a fresh run."""
    run = workspace.new_run()
    try:
        return ingest_github(req.url, run, ref=req.ref)
    except IngestError as exc:
        workspace.cleanup(run.runId)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        workspace.cleanup(run.runId)
        raise


# --- analysis stages ---------------------------------------------------------

# Per-run caches. A run's source is immutable after ingest, so the analysis and
# plan derived from it never change for that runId — a second call is a read.
# The cache is invalidated only by a new upload (new runId → fresh workspace) or
# the run being reaped (TTL sweep / cleanup). A stale/corrupt file is ignored
# and recomputed, which also covers a schema change across versions.
_ANALYSIS_CACHE = "analysis.json"
_PLAN_CACHE = "plan.json"

_ModelT = TypeVar("_ModelT", bound=BaseModel)


def _run_for(req: SourceRequest) -> Optional[workspace.Run]:
    """The run backing this request (for caching), or None in local-path mode."""
    return _get_run_or_404(req.runId) if req.runId else None


def _read_cache(run: workspace.Run, name: str, model: type[_ModelT]) -> Optional[_ModelT]:
    path = run.root / name
    if not path.is_file():
        return None
    try:
        return model.model_validate_json(path.read_text())
    except Exception:  # stale/corrupt (e.g. schema drift) → recompute
        return None


def _write_cache(run: workspace.Run, name: str, value: BaseModel) -> None:
    (run.root / name).write_text(value.model_dump_json())


@app.post("/api/parse", response_model=KnowledgeGraph)
def parse(req: SourceRequest) -> KnowledgeGraph:
    """Parse stage: run the Node worker and return the Knowledge Graph JSON."""
    return _build_kg(_source_for(req))


@app.post("/api/analyze", response_model=AnalysisReport)
def analyze(req: SourceRequest) -> AnalysisReport:
    """Analysis stage: parse the project, then analyze migratability (cached per run)."""
    run = _run_for(req)
    if run is not None:
        cached = _read_cache(run, _ANALYSIS_CACHE, AnalysisReport)
        if cached is not None:
            return cached
        plan_cached = _read_cache(run, _PLAN_CACHE, PlanResponse)
        if plan_cached is not None:
            return plan_cached.report

    report = _analyze(_build_kg(_source_for(req)))
    if run is not None:
        _write_cache(run, _ANALYSIS_CACHE, report)
    return report


@app.post("/api/plan", response_model=PlanResponse)
def plan(req: SourceRequest) -> PlanResponse:
    """Plan stage: parse + analyze + plan (cached per run — a 2nd call is a read)."""
    run = _run_for(req)
    if run is not None:
        cached = _read_cache(run, _PLAN_CACHE, PlanResponse)
        if cached is not None:
            return cached

    kg = _build_kg(_source_for(req))
    report = _analyze(kg)
    response = PlanResponse(report=report, plan=_plan(report, kg))
    if run is not None:
        _write_cache(run, _PLAN_CACHE, response)
        _write_cache(run, _ANALYSIS_CACHE, report)
    return response


# --- Migrate stage -----------------------------------------------------------


class MigrateRequest(SourceRequest):
    """Request body for the migrate endpoint (a :class:`SourceRequest` + options)."""

    answers: dict[str, str] = Field(
        default_factory=dict,
        description="Ask-stage answers, e.g. {'styling-engine': 'nativewind'}.",
    )
    install: bool = Field(True, description="Run npm install (cached across runs).")
    runBundle: bool = Field(True, description="Run the Metro bundle (slowest stage).")


@app.post("/api/migrate", response_model=JobCreated, status_code=202)
def migrate(req: MigrateRequest) -> JobCreated:
    """Migrate stage: start a background job and return immediately (``202``).

    The migration (emit → npm install → tsc → Metro → repair → done) runs in the
    background; follow it live via ``GET /api/jobs/{jobId}/events`` (SSE) or poll
    ``GET /api/jobs/{jobId}``. The RN project is emitted into the run's
    ``output/`` dir, so ``GET /api/runs/{runId}/download`` can package it after.
    """
    source = _source_for(req)

    # Every job is hosted by a run workspace (so its state + output have a home).
    if req.runId:
        run = _get_run_or_404(req.runId)
    else:
        run = workspace.new_run()
    out_dir = run.output_dir

    job = jobs.create_job(run.runId)
    jobs.start_job(
        job.jobId,
        source_root=source,
        run_id=run.runId,
        out_dir=out_dir,
        answers=req.answers,
        install=req.install,
        run_bundle=req.runBundle,
    )
    return JobCreated(jobId=job.jobId, status=job.status)


# --- Jobs: state + event stream ----------------------------------------------


def _get_job_or_404(job_id: str) -> JobState:
    try:
        return jobs.get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"No such job: {job_id}") from exc


@app.get("/api/jobs/{job_id}", response_model=JobState)
def job_state(job_id: str) -> JobState:
    """The full, reconstructable job state — a late joiner rebuilds the whole
    picture (events so far + final result/error) from this alone."""
    return _get_job_or_404(job_id)


def _sse(event_type: str, seq: int, payload: str) -> str:
    """Format one Server-Sent Event. ``id`` = seq, so a reconnecting client can
    resume with ``Last-Event-ID`` and lose nothing."""
    return f"id: {seq}\nevent: {event_type}\ndata: {payload}\n\n"


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request) -> StreamingResponse:
    """SSE stream of the job's events, in order. Replays everything after the
    client's ``Last-Event-ID`` (or from the start), then streams live until the
    terminal event, then closes. The stream is a convenience over
    ``GET /api/jobs/{id}`` — never the source of truth."""
    _get_job_or_404(job_id)

    header_id = request.headers.get("last-event-id")
    query_id = request.query_params.get("lastEventId")
    try:
        last_seq = int(header_id if header_id is not None else (query_id or 0))
    except ValueError:
        last_seq = 0

    async def stream():
        sent = last_seq
        while True:
            try:
                new_events, _status = jobs.events_after(job_id, sent)
            except KeyError:
                break
            for event in new_events:
                yield _sse(event.type, event.seq, event.model_dump_json())
                sent = event.seq
                if event.type in ("succeeded", "failed"):
                    return
            if await request.is_disconnected():
                return
            await asyncio.sleep(0.1)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- Download stage ----------------------------------------------------------


def _zip_output(out_dir: Path) -> Path:
    """Zip the emitted RN project (minus vendor/build dirs) to a temp file."""
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.close()
    with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(out_dir.rglob("*")):
            rel = path.relative_to(out_dir)
            if set(rel.parts) & _DOWNLOAD_SKIP:
                continue
            if path.is_file() and not path.is_symlink():
                zf.write(path, rel.as_posix())
    return Path(tmp.name)


@app.get("/api/runs/{run_id}/download")
def download(run_id: str) -> FileResponse:
    """Download stage: stream the emitted React Native project back as a ZIP."""
    run = _get_run_or_404(run_id)
    out_dir = run.output_dir
    if not out_dir.is_dir() or not any(out_dir.iterdir()):
        raise HTTPException(
            status_code=404, detail=f"Run {run_id} has no emitted output yet — run /api/migrate first."
        )
    zip_path = _zip_output(out_dir)
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"rejox-{run_id}.zip",
        background=BackgroundTask(lambda: zip_path.unlink(missing_ok=True)),
    )
