"""In-process job store + background runner for the async Migration Engine.

A migration job runs in a background thread (no Celery, no Redis — in-process is
enough for now). Its state is the **source of truth**: every event is appended
to :class:`JobState`, which is both held in memory and persisted to the run
workspace (``{run}/job.json``) so it survives the request that created it and a
late joiner / reconnecting client can reconstruct the whole picture from
``GET /api/jobs/{id}`` alone.

Durability, stated plainly:
- The in-memory registry is the live source of truth for the process lifetime.
- ``job.json`` is written on every state change, so a **completed** job survives
  a process restart (``get_job`` falls back to scanning run workspaces).
- A job still **running** when the process dies does NOT survive — its thread is
  gone. Its last-persisted ``job.json`` remains (status ``running``), but it will
  never advance. We do not resurrect running jobs.
"""

from __future__ import annotations

import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from app.models.jobs import (
    JobState,
    MigrationError,
    MigrationEvent,
    MigrationEventData,
    MigrationResult,
    MigrationStage,
)
from app.pipeline import workspace
from app.pipeline.analyzer import analyze_graph
from app.pipeline.intelligence import build_knowledge_graph
from app.pipeline.migrate import run_migration
from app.pipeline.planner import plan_migration

_REGISTRY: dict[str, JobState] = {}
# Live worker threads, so concurrency is measured from what is actually running
# rather than from a status a dead thread can no longer update.
_WORKERS: dict[str, threading.Thread] = {}
_LOCK = threading.Lock()


def _now() -> float:
    return time.time()


def _persist(state: JobState) -> None:
    """Write the job state to its run workspace. Best-effort; never fatal."""
    if not state.runId:
        return
    try:
        run = workspace.get_run(state.runId)
        (run.root / "job.json").write_text(state.model_dump_json())
    except Exception:  # pragma: no cover - persistence is a convenience
        pass


def create_job(run_id: str) -> JobState:
    """Register a fresh queued job bound to a run workspace."""
    job_id = uuid.uuid4().hex
    now = _now()
    state = JobState(
        jobId=job_id, runId=run_id, status="queued", createdAt=now, updatedAt=now
    )
    with _LOCK:
        _REGISTRY[job_id] = state
    _persist(state)
    return state


def _load_persisted(job_id: str) -> Optional[JobState]:
    """Scan run workspaces for a persisted ``job.json`` with this id."""
    for child in workspace.workspace_root().iterdir():
        jf = child / "job.json"
        if not jf.is_file():
            continue
        try:
            persisted = JobState.model_validate_json(jf.read_text())
        except Exception:  # pragma: no cover - skip corrupt files
            continue
        if persisted.jobId == job_id:
            return persisted
    return None


def get_job(job_id: str) -> JobState:
    """Return the job's full state — the reconstructable source of truth.

    In-memory first (live), returned as a deep copy so callers never observe a
    half-applied mutation. Falls back to a persisted ``job.json`` so a completed
    job survives a process restart.
    """
    with _LOCK:
        state = _REGISTRY.get(job_id)
        if state is not None:
            return state.model_copy(deep=True)
    persisted = _load_persisted(job_id)
    if persisted is not None:
        return persisted
    raise KeyError(job_id)


def running_count() -> int:
    """How many migrations are actually executing in THIS process right now.

    A migration installs a dependency tree and runs Metro, so the box — not the
    per-minute rate limit — is the real ceiling on how many may run at once.

    Counted from **live worker threads**, never from stored status. A job whose
    thread died without writing a terminal event keeps ``status == "running"``
    forever; counting that would wedge the endpoint permanently at its
    concurrency limit. A thread that is gone is not consuming the box, whatever
    its last recorded status says.
    """
    with _LOCK:
        alive = [job_id for job_id, t in _WORKERS.items() if t.is_alive()]
        # Finished threads are dropped here rather than in the worker, so the
        # bookkeeping cannot be skipped by a worker that dies abruptly.
        for job_id in list(_WORKERS):
            if job_id not in alive:
                del _WORKERS[job_id]
        return len(alive)


def events_after(job_id: str, after_seq: int) -> tuple[list[MigrationEvent], str]:
    """Thread-safe snapshot for the SSE stream: the events with ``seq >
    after_seq`` plus the job's current status. Copies under the lock so the
    stream never iterates the live list while the worker appends to it."""
    with _LOCK:
        state = _REGISTRY.get(job_id)
        if state is not None:
            fresh = [e.model_copy(deep=True) for e in state.events if e.seq > after_seq]
            return fresh, state.status
    persisted = _load_persisted(job_id)
    if persisted is None:
        raise KeyError(job_id)
    return [e for e in persisted.events if e.seq > after_seq], persisted.status


def _emit_sink(job_id: str):
    """Build the ``emit`` callback the orchestrator drives; stamps seq + ts,
    appends to the job, updates terminal status, and persists."""

    def emit(
        type: str,
        stage: str,
        message: str,
        *,
        data: Optional[MigrationEventData] = None,
        result: Optional[MigrationResult] = None,
        error: Optional[MigrationError] = None,
    ) -> None:
        with _LOCK:
            state = _REGISTRY[job_id]
            seq = len(state.events) + 1
            event = MigrationEvent(
                seq=seq, type=type, stage=stage, ts=_now(),  # type: ignore[arg-type]
                message=message, data=data, result=result, error=error,
            )
            state.events.append(event)
            state.updatedAt = event.ts
            if type == "succeeded":
                state.status = "succeeded"
                state.result = result
            elif type == "failed":
                state.status = "failed"
                state.error = error
            snapshot = state.model_copy(deep=True)
        _persist(snapshot)

    return emit


def _has_terminal(job_id: str) -> bool:
    with _LOCK:
        state = _REGISTRY.get(job_id)
        return bool(state and state.status in ("succeeded", "failed"))


def start_job(
    job_id: str,
    *,
    source_root: Path,
    run_id: str,
    out_dir: Path,
    answers: dict[str, str],
    install: bool,
    run_bundle: bool,
) -> None:
    """Kick off the migration in a daemon thread. Returns immediately."""
    emit = _emit_sink(job_id)

    def worker() -> None:
        with _LOCK:
            state = _REGISTRY[job_id]
            state.status = "running"
            state.updatedAt = _now()
            snapshot = state.model_copy(deep=True)
        _persist(snapshot)
        # The stage the job is actually in, advanced as each one is entered, so
        # a failure before the Migration Engine is reported where it happened
        # (parse/analyze/plan) instead of being blamed on emit.
        stage: MigrationStage = "intelligence"
        try:
            kg = build_knowledge_graph(source_root)
            stage = "analyze"
            report = analyze_graph(kg)
            stage = "plan"
            plan = plan_migration(report, kg)
            stage = "emit"
            run_migration(
                kg=kg, report=report, plan=plan, source_root=source_root,
                answers=answers, out_dir=out_dir, run_id=run_id,
                install=install, run_bundle=run_bundle, emit=emit,
            )
        except Exception as exc:  # noqa: BLE001 - report every failure honestly
            # run_migration emits its own 'failed' (with its own current stage)
            # for anything inside the Migration Engine; this covers the setup
            # stages above it, and anything that escaped without a terminal.
            if not _has_terminal(job_id):
                emit(
                    "failed", stage, f"Migration failed during {stage}: {exc}",
                    error=MigrationError(type=type(exc).__name__, message=str(exc), stage=stage),
                )

    thread = threading.Thread(target=worker, name=f"migrate-{job_id[:8]}", daemon=True)
    with _LOCK:
        _WORKERS[job_id] = thread
    thread.start()
