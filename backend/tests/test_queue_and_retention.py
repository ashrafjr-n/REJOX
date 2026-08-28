"""Tests for the operational layer: where a migration runs, and when its data
is deleted.

Both exist because the alternative was silent. Job state used to live only in a
thread inside the API process, so a restart lost in-flight work with no trace;
and ``workspace.sweep()`` was written, documented, and never called, so uploaded
projects accumulated on disk under a retention policy that did not run.
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from app import jobs, queue, retention
from app.pipeline import workspace
from app.queue import QueueError


# --- Backend selection -------------------------------------------------------


def test_default_backend_is_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("REJOX_QUEUE", raising=False)
    assert queue.backend() == "thread"


def test_unknown_backend_is_rejected_not_defaulted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REJOX_QUEUE", "celery")
    with pytest.raises(QueueError, match="not a backend"):
        queue.backend()


def test_rq_backend_never_falls_back_to_a_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    """The dangerous failure: Redis is down, so the job quietly runs in-process
    and dies with it — exactly when durability was the reason for the queue."""
    monkeypatch.setenv("REJOX_QUEUE", "rq")
    monkeypatch.setenv("REJOX_REDIS_URL", "redis://127.0.0.1:1/0")  # nothing there

    started: list[str] = []
    monkeypatch.setattr(jobs, "run_job", lambda *a, **k: started.append("ran"))

    with pytest.raises(QueueError, match="Could not enqueue"):
        queue.enqueue(
            "job-1",
            source_root=Path("/tmp/src"),
            run_id="run-1",
            out_dir=Path("/tmp/out"),
            answers={},
            install=False,
            run_bundle=False,
        )
    assert started == [], "the job must not have run in this process"


def test_thread_backend_dispatches_the_same_unit_of_work(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """`run_job` is one function reached two ways — an rq worker resolves it by
    import path, the thread backend calls it directly."""
    monkeypatch.setenv("REJOX_QUEUE", "thread")
    seen: dict = {}

    def fake_run_job(job_id, **kwargs):
        seen["job_id"] = job_id
        seen.update(kwargs)

    monkeypatch.setattr(jobs, "run_job", fake_run_job)
    queue.enqueue(
        "job-2",
        source_root=tmp_path / "src",
        run_id="run-2",
        out_dir=tmp_path / "out",
        answers={"styling-engine": "nativewind"},
        install=False,
        run_bundle=False,
    )
    for _ in range(100):
        if seen:
            break
        time.sleep(0.02)

    assert seen["job_id"] == "job-2"
    assert seen["run_id"] == "run-2"
    assert seen["answers"] == {"styling-engine": "nativewind"}
    # Paths cross a process boundary as strings and are re-hydrated in run_job.
    assert isinstance(seen["source_root"], str)


# --- Job state is readable across processes ----------------------------------


def test_job_state_survives_this_process_losing_it(monkeypatch: pytest.MonkeyPatch) -> None:
    """With the rq backend the worker owns the in-memory copy and the API only
    ever sees the file, so state has to reconstruct from disk alone."""
    run = workspace.new_run()
    job = jobs.create_job(run.runId)

    # Simulate a different process: nothing in this registry.
    monkeypatch.setattr(jobs, "_REGISTRY", {})

    recovered = jobs.get_job(job.jobId)
    assert recovered.jobId == job.jobId
    assert recovered.runId == run.runId
    workspace.cleanup(run.runId)


def test_job_json_is_written_atomically() -> None:
    """A reader in another process must never see a half-written job."""
    run = workspace.new_run()
    job = jobs.create_job(run.runId)
    persisted = run.root / "job.json"
    assert persisted.is_file()
    # The temp file is renamed into place, never left behind.
    assert not (run.root / "job.json.tmp").exists()
    assert job.jobId in persisted.read_text()
    workspace.cleanup(run.runId)


# --- Retention ---------------------------------------------------------------


def test_ttl_is_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REJOX_RUN_TTL_SECONDS", "3600")
    assert workspace.ttl_seconds() == 3600


def test_a_bad_ttl_falls_back_to_the_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REJOX_RUN_TTL_SECONDS", "not-a-number")
    assert workspace.ttl_seconds() == workspace.DEFAULT_TTL_SECONDS


def test_sweep_once_reaps_an_expired_run(monkeypatch: pytest.MonkeyPatch) -> None:
    old = workspace.new_run()
    fresh = workspace.new_run()
    # Age the first run past a one-hour window.
    ancient = time.time() - 7200
    import os

    os.utime(old.root, (ancient, ancient))
    monkeypatch.setenv("REJOX_RUN_TTL_SECONDS", "3600")

    removed = retention.sweep_once()

    assert old.runId in removed
    assert fresh.runId not in removed
    assert not old.root.exists()
    assert fresh.root.exists()
    workspace.cleanup(fresh.runId)


def test_a_failing_sweep_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Retention runs inside the API's lifespan; an unreaped run is something to
    log, never a reason to take the service down."""
    def boom(*_a, **_k):
        raise OSError("disk gone")

    monkeypatch.setattr(workspace, "sweep", boom)
    assert retention.sweep_once() == []


def test_retention_can_be_handed_to_cron(monkeypatch: pytest.MonkeyPatch) -> None:
    # A deployment driving `rejox sweep` externally turns the in-process one off
    # so the two do not race over the same directory.
    monkeypatch.setenv("REJOX_RETENTION", "off")
    assert retention.disabled() is True
    monkeypatch.setenv("REJOX_RETENTION", "on")
    assert retention.disabled() is False


def test_the_reaper_sweeps_immediately_on_start(monkeypatch: pytest.MonkeyPatch) -> None:
    """After downtime the backlog is precisely the runs that outlived their
    window while nothing was watching, so start-up must not wait an interval."""
    calls: list[int] = []
    monkeypatch.setattr(retention, "sweep_once", lambda: calls.append(1) or [])

    reaper = retention.Reaper(interval=3600)
    reaper.start()
    try:
        assert calls == [1]
    finally:
        reaper.stop()
