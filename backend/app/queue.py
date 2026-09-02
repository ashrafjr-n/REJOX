"""Job dispatch — the seam between "a migration was requested" and "a migration
is running somewhere".

A migration takes minutes: it installs a dependency tree, type-checks, and runs
Metro. Where that work happens is a deployment decision, not a pipeline one, so
it is chosen here and nowhere else.

``thread`` (default — CLI, tests, a developer machine)
    The migration runs in a daemon thread inside the API process. Simple and
    dependency-free, and honest about its limits: a job running when the
    process dies is gone, and concurrency is capped by one box.

``rq`` (production)
    The migration is enqueued to Redis and executed by a separate worker
    process. Jobs survive an API restart, workers scale horizontally, and a
    deploy does not kill in-flight migrations — the queue holds them.

The job's *state* is file-backed either way (``{run}/job.json``), so a worker in
another process drives the same job the API reads. This module only decides
WHERE the work runs; ``app.jobs`` owns what the work is.

    queue.enqueue(job_id, source_root=…, run_id=…, out_dir=…, answers=…,
                  install=True, run_bundle=True)
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Literal, Optional

Backend = Literal["thread", "rq"]

DEFAULT_QUEUE_NAME = "rejox-migrations"
# A migration installs a dependency tree and runs Metro; well over the RQ
# default of 180s. Matches the Validator's own stage ceilings with headroom.
DEFAULT_JOB_TIMEOUT_SECONDS = 3600
# Redis connect/read ceiling. Small on purpose: this is a local-network hop, and
# a slow answer here must surface as a 503, not as a request that never returns.
DEFAULT_REDIS_TIMEOUT_SECONDS = 5
# How long a finished job's RQ record is kept. The real state lives in
# job.json, so this only affects the queue's own bookkeeping.
DEFAULT_RESULT_TTL_SECONDS = 24 * 60 * 60


class QueueError(RuntimeError):
    """The configured queue could not be reached — never a reason to silently
    fall back to running the work in-process."""


def env_int(name: str, default: int) -> int:
    """Read an integer setting, falling back to the default on anything unusable.

    Public because ``app.jobs`` reads its own ceilings the same way, and two
    parsers that disagree about what ``REJOX_JOB_HEARTBEAT=""`` means is exactly
    the kind of drift that only shows up in production.
    """
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def backend() -> Backend:
    raw = os.environ.get("REJOX_QUEUE", "thread").strip().lower()
    if raw not in ("thread", "rq"):
        raise QueueError(
            f"REJOX_QUEUE={raw!r} is not a backend; use 'rq' or 'thread'."
        )
    return raw  # type: ignore[return-value]


def redis_url() -> str:
    return os.environ.get("REJOX_REDIS_URL", "redis://localhost:6379/0").strip()


def queue_name() -> str:
    return os.environ.get("REJOX_QUEUE_NAME", DEFAULT_QUEUE_NAME).strip() or DEFAULT_QUEUE_NAME


def get_queue():
    """The RQ queue. Imported lazily so the `thread` backend needs no Redis."""
    try:
        from redis import Redis  # noqa: PLC0415
        from rq import Queue  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - packaging guard
        raise QueueError(
            "REJOX_QUEUE=rq needs the `rq` and `redis` packages. "
            "Install them, or use REJOX_QUEUE=thread."
        ) from exc
    # Bounded timeouts, and no retry-on-timeout. redis-py's defaults wait
    # essentially forever, which turns an unreachable Redis into a POST
    # /api/migrate that hangs for minutes instead of answering 503 — the client
    # cannot tell "queue is down" from "still thinking".
    timeout = env_int("REJOX_REDIS_TIMEOUT", DEFAULT_REDIS_TIMEOUT_SECONDS)
    connection = Redis.from_url(
        redis_url(),
        socket_connect_timeout=timeout,
        socket_timeout=timeout,
        retry_on_timeout=False,
    )
    return Queue(
        queue_name(),
        connection=connection,
        default_timeout=env_int("REJOX_JOB_TIMEOUT", DEFAULT_JOB_TIMEOUT_SECONDS),
    )


# --- dispatch ----------------------------------------------------------------


def _enqueue_thread(job_id: str, payload: dict[str, Any]) -> None:
    from app import jobs  # noqa: PLC0415 - circular at module scope

    def run() -> None:
        try:
            jobs.run_job(job_id, **payload)
        except jobs.MigrationFailed:
            # `run_job` raises this so an rq worker's own record agrees with the
            # job's. In this backend there is no such second record — the job
            # state IS this process's record, and it already says `failed`. Let
            # it go rather than dumping a thread traceback that reports nothing
            # new. Any OTHER exception still surfaces: that would be a defect
            # here, not a failed migration.
            pass

    thread = threading.Thread(
        target=run,
        name=f"migrate-{job_id[:8]}",
        daemon=True,
    )
    jobs.register_worker(job_id, thread)
    thread.start()


def _enqueue_rq(job_id: str, payload: dict[str, Any]) -> None:
    try:
        q = get_queue()
        q.enqueue(
            "app.jobs.run_job",
            job_id,
            **payload,
            job_id=job_id,  # RQ's own id == ours, so the record is findable
            result_ttl=env_int("REJOX_RESULT_TTL", DEFAULT_RESULT_TTL_SECONDS),
        )
    except QueueError:
        raise
    except Exception as exc:  # redis down, auth, DNS…
        # Never fall back to a thread: that would silently turn a durable job
        # into one that dies with this process, exactly when the queue is the
        # thing that was supposed to keep it alive.
        raise QueueError(f"Could not enqueue to Redis at {redis_url()}: {exc}") from exc


def enqueue(
    job_id: str,
    *,
    source_root: Path,
    run_id: str,
    out_dir: Path,
    answers: dict[str, str],
    install: bool,
    run_bundle: bool,
) -> None:
    """Dispatch a migration to the configured backend. Returns immediately."""
    # Paths are serialized as strings: an RQ payload crosses a process boundary
    # as JSON-ish pickled data, and `run_job` re-hydrates them.
    payload: dict[str, Any] = {
        "source_root": str(source_root),
        "run_id": run_id,
        "out_dir": str(out_dir),
        "answers": answers,
        "install": install,
        "run_bundle": run_bundle,
    }
    if backend() == "rq":
        _enqueue_rq(job_id, payload)
    else:
        _enqueue_thread(job_id, payload)


def running_count() -> Optional[int]:
    """Migrations currently executing, or None when the backend cannot say.

    In ``rq`` mode this counts the whole fleet, not this process — which is the
    point of running a fleet. Returns None if Redis cannot be reached, so the
    caller admits it does not know rather than inventing a zero that would wave
    every request through.
    """
    if backend() != "rq":
        from app import jobs  # noqa: PLC0415

        return jobs.local_running_count()
    try:
        from rq.registry import StartedJobRegistry  # noqa: PLC0415

        q = get_queue()
        return StartedJobRegistry(queue=q).count + q.count
    except Exception:
        return None
