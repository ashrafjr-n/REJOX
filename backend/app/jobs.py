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
  gone. We do not resurrect it. What we do instead is *say so*: the executing
  process stamps a heartbeat into ``job.json`` on a fixed beat, and a reader
  that finds a ``running`` job whose heartbeat has stopped marks it terminally
  ``failed``. A job whose worker died therefore ends as a failure a client can
  see, never as ``running`` for ever (pre-launch gate B6).
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
from app import logs
from app.queue import env_int

# How often the process executing a job stamps ``job.json`` to say it is still
# there, and how long a reader waits for a beat before calling the job
# abandoned. The grace is deliberately several beats wide: a worker under load
# may miss one, and a false "failed" on a migration that is still running is a
# worse answer than a slightly late one.
DEFAULT_HEARTBEAT_SECONDS = 10
DEFAULT_HEARTBEAT_GRACE_SECONDS = 60

# Jobs THIS process is executing, and only those. A process that merely created
# a job must not keep a copy here: with the `rq` backend the API creates the job
# and a worker runs it, so an API-side entry would shadow the file the worker is
# updating and every read would answer `queued` forever. The executing process
# adopts the persisted state on first touch (`run_job`, `_emit_sink`); everyone
# else reads job.json.
_REGISTRY: dict[str, JobState] = {}
# Live worker threads, so concurrency is measured from what is actually running
# rather than from a status a dead thread can no longer update.
_WORKERS: dict[str, threading.Thread] = {}
_LOCK = threading.Lock()


class MigrationFailed(RuntimeError):
    """Raised by :func:`run_job` once a migration has ended in ``failed``.

    Not how the failure is *reported* — the terminal event in ``job.json`` is
    that, and it is written before this is raised. This exists so the process
    that ran the job hears about it too.

    Without it, ``run_job`` returned cleanly from every failure (it catches
    everything, on purpose) and RQ logged `Successfully completed` / `Job OK`
    for a migration that had failed. An operator grepping the worker log for
    trouble found a green line, which is worse than an absent one: silence
    invites a question, "Job OK" ends it. Observed at gate E0, 2026-09-03.
    """


def _now() -> float:
    return time.time()


def _persist(state: JobState) -> None:
    """Write the job state to its run workspace.

    Written atomically (temp file + rename): with the `rq` backend a worker
    process writes this file while the API process reads it, and a reader must
    never observe a half-written job. Best-effort; never fatal.
    """
    if not state.runId:
        return
    try:
        run = workspace.get_run(state.runId)
        target = run.root / "job.json"
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(state.model_dump_json())
        tmp.replace(target)
    except Exception:  # pragma: no cover - persistence is a convenience
        pass


def create_job(run_id: str) -> JobState:
    """Register a fresh queued job bound to a run workspace."""
    job_id = uuid.uuid4().hex
    now = _now()
    state = JobState(
        jobId=job_id, runId=run_id, status="queued", createdAt=now, updatedAt=now
    )
    # Persisted, not registered: whoever ends up running this job adopts it from
    # the file. Keeping a copy here would make this process answer from its own
    # memory forever, which is right only when this process is also the one
    # advancing the job — and with the `rq` backend it is not.
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

    In-memory first (this process is running it), returned as a deep copy so
    callers never observe a half-applied mutation. Otherwise the persisted
    ``job.json``, which is what makes the state readable across processes: with
    the `rq` backend the worker owns the memory copy and the API only ever sees
    the file — and is therefore the only party in a position to notice that
    nobody is writing it any more. Hence the reconcile on that path.
    """
    with _LOCK:
        state = _REGISTRY.get(job_id)
        if state is not None:
            return state.model_copy(deep=True)
    persisted = _load_persisted(job_id)
    if persisted is not None:
        return _reconcile(persisted)
    raise KeyError(job_id)


def local_running_count() -> int:
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
    persisted = _reconcile(persisted)
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
            # An `rq` worker executes a job the API process created, so this
            # process may have no registry entry for it. Adopt the persisted
            # state on first touch; from then on this process owns the memory
            # copy and the file is the view everyone else reads.
            state = _REGISTRY.get(job_id)
            if state is None:
                state = _load_persisted(job_id)
                if state is None:
                    raise KeyError(job_id)
                _REGISTRY[job_id] = state
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
        # Logged outside the lock, and after the state is durable: the log is a
        # record of what happened, so it must not be able to claim more than
        # job.json does. Gate E0 — before this, no stage boundary was logged at
        # all and a failure named neither its stage nor its reason.
        if type == "failed":
            logs.failure(
                "job_failed", stage=stage, seq=seq,
                errorType=error.type if error else None,
                reason=error.message if error else message,
            )
        else:
            logs.event(f"job_{type}", stage=stage, seq=seq)

    return emit


def _heartbeat_interval() -> float:
    return float(max(1, env_int("REJOX_JOB_HEARTBEAT", DEFAULT_HEARTBEAT_SECONDS)))


def _heartbeat_grace() -> float:
    return float(
        max(1, env_int("REJOX_JOB_HEARTBEAT_GRACE", DEFAULT_HEARTBEAT_GRACE_SECONDS))
    )


def _touch(job_id: str) -> None:
    """Stamp "I am still executing this" into ``job.json``.

    Only ``updatedAt`` moves — no event is invented, because nothing happened.
    That distinction matters: events are the record of what the pipeline did,
    and a heartbeat is not one of them.
    """
    with _LOCK:
        state = _REGISTRY.get(job_id)
        # Terminal states are never touched: a finished job that kept ticking
        # would look alive to every reader that came after it.
        if state is None or state.status != "running":
            return
        state.updatedAt = _now()
        snapshot = state.model_copy(deep=True)
    _persist(snapshot)


def _start_heartbeat(job_id: str) -> threading.Event:
    """Beat until the returned event is set. Daemon: it must never hold up exit.

    Needed because stages are long and *silent* — ``npm install`` can run for
    minutes without emitting anything — so "no new events" cannot be read as "no
    executor". A separate beat makes staleness mean exactly one thing.
    """
    stop = threading.Event()

    def beat() -> None:
        interval = _heartbeat_interval()
        while not stop.wait(interval):
            _touch(job_id)

    threading.Thread(
        target=beat, name=f"heartbeat-{job_id[:8]}", daemon=True
    ).start()
    return stop


def _fail_abandoned(state: JobState) -> JobState:
    """Close out a job whose executor is gone, with a terminal ``failed`` event.

    Written straight to the file rather than through ``_emit_sink``: this
    process is not running the job and must not adopt it into ``_REGISTRY``,
    which is reserved for jobs it *is* executing.

    Two readers racing here both append the same terminal event and the last
    atomic write wins, which is harmless — they agree about the outcome.
    """
    stage: MigrationStage = state.events[-1].stage if state.events else "intelligence"
    silent_for = _now() - state.updatedAt
    message = (
        "The process running this migration stopped without reporting a result "
        f"(no heartbeat for {silent_for:.0f}s, past the {_heartbeat_grace():.0f}s "
        "grace). The migration did not complete; start it again."
    )
    error = MigrationError(type="WorkerLost", message=message, stage=stage)
    event = MigrationEvent(
        seq=len(state.events) + 1,
        type="failed",
        stage=stage,
        ts=_now(),
        message=message,
        error=error,
    )
    state.events.append(event)
    state.status = "failed"
    state.error = error
    state.updatedAt = event.ts
    _persist(state)
    # The process that was running this job is gone, so it will never log the
    # failure itself. THIS is the only party that can, and gate E0 found the
    # silence where this line now goes.
    with logs.bound(run_id=state.runId, job_id=state.jobId):
        logs.failure(
            "job_abandoned", stage=stage, errorType="WorkerLost",
            silentForSeconds=round(silent_for, 1), graceSeconds=_heartbeat_grace(),
        )
    return state


def _reconcile(state: JobState) -> JobState:
    """Answer with the truth about a persisted job, not just its last write.

    Applied ONLY to state loaded from ``job.json`` — never to a registry entry,
    because a registry entry belongs to a job this process is running right now
    and its heartbeat is this process's own responsibility.

    Known trade-off, recorded rather than hidden: a live worker frozen for
    longer than the grace (a suspended host, a badly throttled container) is
    declared lost, and if it later thaws it will keep writing and the job will
    come back to life. That is rarer, and less damaging, than the wedge this
    replaces — but it is why the grace is a setting.
    """
    if state.status != "running":
        return state
    if _now() - state.updatedAt <= _heartbeat_grace():
        return state
    return _fail_abandoned(state)


def _has_terminal(job_id: str) -> bool:
    try:
        return get_job(job_id).status in ("succeeded", "failed")
    except KeyError:
        return False


def run_job(
    job_id: str,
    *,
    source_root: Path | str,
    run_id: str,
    out_dir: Path | str,
    answers: dict[str, str],
    install: bool,
    run_bundle: bool,
) -> None:
    """Execute one migration to completion. THE unit of work.

    A module-level function on purpose: with the `rq` backend this is resolved
    by import path in a worker process that never saw the request, so it takes
    plain, serializable arguments and re-hydrates them here. It is the same
    function the `thread` backend runs, so there is exactly one migration code
    path regardless of where it executes.

    Every failure becomes a terminal ``failed`` event first — a job that
    vanished without saying why is the one thing the event stream must not
    allow. Only then, if the job ended ``failed``, does this raise
    :class:`MigrationFailed`, so the process running it records the same outcome
    the job did. The event stream never depends on that raise.
    """
    source_root = Path(source_root)
    out_dir = Path(out_dir)
    emit = _emit_sink(job_id)
    # Bound here rather than passed down: every line logged by every stage below
    # carries the run and job without any of them having to know about logging.
    binding = logs.bound(run_id=run_id, job_id=job_id)
    binding.__enter__()

    with _LOCK:
        state = _REGISTRY.get(job_id)
        if state is None:
            state = _load_persisted(job_id)
            if state is None:
                # Nothing to report progress against — the run workspace is
                # gone (reaped, or never created). Fail loudly in the worker log
                # rather than half-running a job nobody can observe.
                raise KeyError(f"No such job: {job_id}")
            _REGISTRY[job_id] = state
        state.status = "running"
        state.updatedAt = _now()
        snapshot = state.model_copy(deep=True)
    _persist(snapshot)

    # The stage the job is actually in, advanced as each one is entered, so
    # a failure before the Migration Engine is reported where it happened
    # (parse/analyze/plan) instead of being blamed on emit.
    stage: MigrationStage = "intelligence"
    # From here on this process owes the job a heartbeat: everything below can
    # run for minutes in silence, and silence is what a reader is about to
    # interpret. Stopped in the `finally`, so a job that ends any way at all —
    # success, failure, or an exception nothing caught — stops beating.
    stop_heartbeat = _start_heartbeat(job_id)
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
    finally:
        stop_heartbeat.set()
        binding.__exit__(None, None, None)

    # The terminal event is written by now, either way. Tell the runner what it
    # was: a worker's own record of this job must not contradict the job's.
    final = get_job(job_id)
    if final.status == "failed":
        detail = final.error.message if final.error else "no error recorded"
        kind = final.error.type if final.error else "MigrationError"
        where = final.error.stage if final.error and final.error.stage else stage
        raise MigrationFailed(f"{job_id} failed during {where} — {kind}: {detail}")


def register_worker(job_id: str, thread: threading.Thread) -> None:
    """Record a `thread`-backend worker so local concurrency can be measured."""
    with _LOCK:
        _WORKERS[job_id] = thread


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
    """Dispatch the migration to the configured queue backend (see app.queue).

    Returns immediately; where the work actually runs — a thread here or a
    worker process behind Redis — is a deployment choice made in one place.
    """
    from app import queue  # noqa: PLC0415 - queue imports jobs for the thread path

    queue.enqueue(
        job_id,
        source_root=source_root,
        run_id=run_id,
        out_dir=out_dir,
        answers=answers,
        install=install,
        run_bundle=run_bundle,
    )
