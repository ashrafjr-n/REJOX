"""Job layer + SSE mechanics — fast, offline (emit only; no install/tsc/Metro).

These prove the async contract without the slow toolchain: POST returns 202 in
well under a second, the job runs in the background, the event log is ordered
and complete, and the SSE stream can be joined late and reconnected without
losing anything. The full real-toolchain assertion (tsc/Metro/LLM counts) lives
in the ``slow``-marked ``test_migrate_stream.py``.
"""

from __future__ import annotations

import io
import json
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE = REPO_ROOT / "test-projects" / "sample-app"
_SKIP = {"node_modules", ".git", "dist", "build"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    return TestClient(app)


def _sample_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(SAMPLE.rglob("*")):
            rel = path.relative_to(SAMPLE)
            if set(rel.parts) & _SKIP or not path.is_file():
                continue
            zf.writestr(f"sample-app/{rel.as_posix()}", path.read_bytes())
    return buf.getvalue()


def _upload(client) -> str:
    up = client.post(
        "/api/upload",
        files={"file": ("sample-app.zip", _sample_zip(), "application/zip")},
    )
    assert up.status_code == 200, up.text
    return up.json()["runId"]


def _start_emit_only(client, run_id: str) -> str:
    resp = client.post(
        "/api/migrate",
        json={"runId": run_id, "install": False, "runBundle": False},
    )
    assert resp.status_code == 202, resp.text
    return resp.json()["jobId"]


# Emit-only migrations take a few seconds on an idle machine, but this suite also
# runs on a CI runner and next to a `docker compose` verification pass, where the
# same work has been observed taking past 60s (2026-09-03). The ceiling exists to
# stop a hung job from hanging the suite, not to assert a speed — so it is set
# well clear of the slow case, and the failure says what to look at.
_AWAIT_TIMEOUT = 240.0


def _await(client, job_id: str, timeout: float = _AWAIT_TIMEOUT) -> dict:
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        state = client.get(f"/api/jobs/{job_id}").json()
        if state["status"] in ("succeeded", "failed"):
            return state
        last = state
        time.sleep(0.05)
    raise AssertionError(
        f"job {job_id} did not finish in {timeout}s — last status "
        f"{(last or {}).get('status')!r} after {len((last or {}).get('events', []))} event(s)"
    )


def _read_sse(client, url: str, headers=None, timeout: float = _AWAIT_TIMEOUT):
    """Read an SSE stream to its terminal event; return [(event_type, data)]."""
    events: list[tuple[str, dict]] = []
    with client.stream("GET", url, headers=headers or {}, timeout=timeout) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        cur: dict[str, str] = {}
        for line in resp.iter_lines():
            if line == "":
                if "data" in cur:
                    events.append((cur.get("event", ""), json.loads(cur["data"])))
                    if cur.get("event") in ("succeeded", "failed"):
                        break
                cur = {}
                continue
            key, _, val = line.partition(":")
            cur[key.strip()] = val.strip()
    return events


# The true, ordered boundaries for an emit-only run (install/tsc/Metro skipped
# but still stepped through and reported honestly as ran=False).
_EXPECTED_ORDER = [
    ("stage_started", "emit"),
    ("stage_completed", "emit"),
    ("stage_started", "install"),
    ("stage_completed", "install"),
    ("stage_started", "typecheck"),
    ("stage_completed", "typecheck"),
    ("stage_started", "bundle"),
    ("stage_completed", "bundle"),
    ("succeeded", "done"),
]


def test_migrate_returns_202_under_a_second(client) -> None:
    run_id = _upload(client)
    start = time.monotonic()
    resp = client.post(
        "/api/migrate", json={"runId": run_id, "install": False, "runBundle": False}
    )
    elapsed = time.monotonic() - start
    assert resp.status_code == 202, resp.text
    assert resp.json()["status"] in ("queued", "running")
    assert resp.json()["jobId"]
    assert elapsed < 1.0, f"POST /api/migrate took {elapsed:.3f}s — must be well under 1s"


def test_job_events_ordered_and_late_joiner_sees_everything(client) -> None:
    run_id = _upload(client)
    job_id = _start_emit_only(client, run_id)
    state = _await(client, job_id)
    assert state["status"] == "succeeded", state.get("error")

    # Late joiner: GET reconstructs the full picture from job state alone.
    order = [(e["type"], e["stage"]) for e in state["events"]]
    assert order == _EXPECTED_ORDER
    # seq is strictly increasing from 1.
    assert [e["seq"] for e in state["events"]] == list(range(1, len(state["events"]) + 1))
    # Real emit counts (not estimated).
    emit_done = next(e for e in state["events"] if e["type"] == "stage_completed" and e["stage"] == "emit")
    assert emit_done["data"]["filesConverted"] > 0
    assert emit_done["data"]["filesEmitted"] >= emit_done["data"]["filesConverted"]
    # Terminal result present and self-consistent.
    result = state["result"]
    assert result["runId"] == run_id
    assert result["filesConverted"] == emit_done["data"]["filesConverted"]
    assert result["repairRounds"] == 0


def test_sse_stream_matches_job_state_and_closes(client) -> None:
    run_id = _upload(client)
    job_id = _start_emit_only(client, run_id)

    events = _read_sse(client, f"/api/jobs/{job_id}/events")
    order = [(t, d["stage"]) for t, d in events]
    assert order == _EXPECTED_ORDER
    assert events[-1][0] == "succeeded"  # stream closed right after the terminal

    # The stream is a convenience: GET returns the identical picture.
    state = client.get(f"/api/jobs/{job_id}").json()
    assert [(e["type"], e["stage"]) for e in state["events"]] == order
    assert state["result"] is not None


def test_sse_reconnect_with_last_event_id_loses_nothing(client) -> None:
    run_id = _upload(client)
    job_id = _start_emit_only(client, run_id)
    _await(client, job_id)

    full = _read_sse(client, f"/api/jobs/{job_id}/events")
    assert full[-1][0] == "succeeded"
    total = full[-1][1]["seq"]

    # Reconnect from the middle: Last-Event-ID = 4 → we must receive 5..terminal,
    # contiguous, with nothing skipped or duplicated.
    resumed = _read_sse(
        client, f"/api/jobs/{job_id}/events", headers={"Last-Event-ID": "4"}
    )
    seqs = [d["seq"] for _, d in resumed]
    assert seqs == list(range(5, total + 1))
    assert resumed[-1][0] == "succeeded"


def test_unknown_job_is_404(client) -> None:
    assert client.get("/api/jobs/deadbeefdeadbeef").status_code == 404
    assert client.get("/api/jobs/deadbeefdeadbeef/events").status_code == 404


# --- Failure attribution (the stage that actually failed) --------------------


@pytest.mark.parametrize(
    ("target", "stage"),
    [
        ("build_knowledge_graph", "intelligence"),
        ("analyze_graph", "analyze"),
        ("plan_migration", "plan"),
    ],
)
def test_failure_before_migration_reports_the_real_stage(
    client, monkeypatch, target: str, stage: str
) -> None:
    """A job that dies while building the graph / analyzing / planning says so —
    it is not blamed on emit, which never started."""
    import app.jobs as jobs_mod

    def boom(*_args, **_kwargs):
        raise RuntimeError(f"{target} exploded")

    monkeypatch.setattr(jobs_mod, target, boom)
    run_id = _upload(client)
    job_id = _start_emit_only(client, run_id)
    state = _await(client, job_id)

    assert state["status"] == "failed"
    assert state["error"]["stage"] == stage
    assert state["error"]["type"] == "RuntimeError"
    assert state["events"][-1]["stage"] == stage
    assert stage in state["events"][-1]["message"]


# --- Cross-process state (the `rq` deployment) -------------------------------


def test_the_api_sees_a_job_another_process_is_advancing(tmp_path, monkeypatch) -> None:
    """With the `rq` backend the API creates a job and a WORKER runs it.

    The API therefore has no business holding a memory copy: it would shadow the
    file the worker is writing, and every poll would answer `queued` while the
    migration ran to completion behind it. `job.json` is the seam between the two
    processes, so a read must reflect what the other process last wrote.
    """
    import app.jobs as jobs_mod
    from app.models.jobs import JobState
    from app.pipeline import workspace

    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    jobs_mod._REGISTRY.clear()

    run = workspace.new_run()
    job = jobs_mod.create_job(run.runId)

    # Creating a job must leave nothing behind in this process: whoever runs it
    # adopts it from the file.
    assert job.jobId not in jobs_mod._REGISTRY
    assert jobs_mod.get_job(job.jobId).status == "queued"

    # Another process advances it and writes job.json, exactly as a worker does.
    advanced = JobState.model_validate_json((run.root / "job.json").read_text())
    advanced.status = "running"
    advanced.updatedAt = advanced.createdAt + 1
    (run.root / "job.json").write_text(advanced.model_dump_json())

    assert jobs_mod.get_job(job.jobId).status == "running"
    _events, status = jobs_mod.events_after(job.jobId, 0)
    assert status == "running"


# --- A worker that dies (pre-launch gate B6) ---------------------------------


def _worker_wrote(run, *, status: str, updated_at: float):
    """Rewrite job.json the way another process would, then hand it back."""
    from app.models.jobs import JobState

    state = JobState.model_validate_json((run.root / "job.json").read_text())
    state.status = status  # type: ignore[assignment]
    state.updatedAt = updated_at
    (run.root / "job.json").write_text(state.model_dump_json())
    return state


def test_a_job_whose_worker_died_is_reported_failed(tmp_path, monkeypatch) -> None:
    """The B6 wedge: an API that serves job.json can only tell a live worker
    from a dead one by whether the file is still moving. A `running` job with no
    heartbeat past the grace must end as `failed`, with an error saying why —
    not stay `running` for a client to poll for ever."""
    import app.jobs as jobs_mod
    from app.pipeline import workspace

    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    monkeypatch.setenv("REJOX_JOB_HEARTBEAT_GRACE", "30")
    jobs_mod._REGISTRY.clear()

    run = workspace.new_run()
    job = jobs_mod.create_job(run.runId)

    # A worker picked it up, ran, and was killed 31s ago — one second past grace.
    _worker_wrote(run, status="running", updated_at=time.time() - 31)

    state = jobs_mod.get_job(job.jobId)
    assert state.status == "failed"
    assert state.error is not None and state.error.type == "WorkerLost"
    assert state.events[-1].type == "failed"

    # And it is written back, so every later reader agrees without re-deciding.
    persisted = jobs_mod._load_persisted(job.jobId)
    assert persisted is not None and persisted.status == "failed"


def test_a_job_still_heartbeating_is_left_alone(tmp_path, monkeypatch) -> None:
    """The other half, and the one that costs real money if it is wrong: a
    migration that is merely slow and silent — npm install can be — must not be
    declared lost while its worker is still stamping the file."""
    import app.jobs as jobs_mod
    from app.pipeline import workspace

    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    monkeypatch.setenv("REJOX_JOB_HEARTBEAT_GRACE", "30")
    jobs_mod._REGISTRY.clear()

    run = workspace.new_run()
    job = jobs_mod.create_job(run.runId)
    _worker_wrote(run, status="running", updated_at=time.time() - 5)

    assert jobs_mod.get_job(job.jobId).status == "running"
    _events, status = jobs_mod.events_after(job.jobId, 0)
    assert status == "running"


def test_a_queued_job_is_never_declared_lost(tmp_path, monkeypatch) -> None:
    """A job waiting in the queue has no executor by definition — an old
    `queued` means the fleet is busy, not that anything died."""
    import app.jobs as jobs_mod
    from app.pipeline import workspace

    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    monkeypatch.setenv("REJOX_JOB_HEARTBEAT_GRACE", "30")
    jobs_mod._REGISTRY.clear()

    run = workspace.new_run()
    job = jobs_mod.create_job(run.runId)
    _worker_wrote(run, status="queued", updated_at=time.time() - 600)

    assert jobs_mod.get_job(job.jobId).status == "queued"


def test_the_heartbeat_keeps_a_silent_job_alive(tmp_path, monkeypatch) -> None:
    """The heartbeat is what makes staleness mean something. Beating on a job
    that emits nothing must move `updatedAt` — and must stop moving it the
    moment the job is stopped."""
    import app.jobs as jobs_mod
    from app.pipeline import workspace

    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    monkeypatch.setenv("REJOX_JOB_HEARTBEAT", "1")
    jobs_mod._REGISTRY.clear()

    run = workspace.new_run()
    job = jobs_mod.create_job(run.runId)
    state = jobs_mod._load_persisted(job.jobId)
    assert state is not None
    state.status = "running"
    jobs_mod._REGISTRY[job.jobId] = state
    before = state.updatedAt

    stop = jobs_mod._start_heartbeat(job.jobId)
    try:
        deadline = time.time() + 10
        while time.time() < deadline:
            if jobs_mod._load_persisted(job.jobId).updatedAt > before:  # type: ignore[union-attr]
                break
            time.sleep(0.1)
        else:
            pytest.fail("the heartbeat never stamped job.json")
        # No event was invented to do it: a beat is not something that happened.
        assert jobs_mod._load_persisted(job.jobId).events == []  # type: ignore[union-attr]
    finally:
        stop.set()
        jobs_mod._REGISTRY.clear()
