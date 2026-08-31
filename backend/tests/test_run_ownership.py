"""Tests for gate C3 — a run belongs to one identity and no other.

A run holds someone's uploaded source code and the project emitted from it. The
only thing that stood between a run and *any* authenticated caller used to be
that a ``runId`` is a ``uuid4`` — unguessable, but not access control, and it
travels in URLs, browser history, proxy access logs and support tickets. These
tests are the standing version of that gate: they assert the refusals, not the
happy path.

The shape asserted throughout is ``404``, never ``403``: a ``403`` confirms the
run exists, which is itself a disclosure to someone who should not know.
"""

from __future__ import annotations

import io
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import security
from app.main import app
from app.pipeline import workspace

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE = REPO_ROOT / "test-projects" / "sample-app"
_SKIP = {"node_modules", ".git", "dist", "build"}

ALPHA = {"Authorization": "Bearer key-alpha"}
BRAVO = {"Authorization": "Bearer key-bravo"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Two real identities, no anonymous fallback — the deployment posture."""
    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    monkeypatch.delenv("REJOX_ALLOW_ANONYMOUS", raising=False)
    monkeypatch.setenv("REJOX_API_KEYS", "key-alpha,key-bravo")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    security.limiter.reset()
    return TestClient(app)


def _sample_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(SAMPLE.rglob("*")):
            rel = path.relative_to(SAMPLE)
            if set(rel.parts) & _SKIP or not path.is_file():
                continue
            zf.writestr(rel.as_posix(), path.read_bytes())
    return buf.getvalue()


def _upload_as(client: TestClient, headers: dict) -> str:
    resp = client.post(
        "/api/upload",
        files={"file": ("sample-app.zip", _sample_zip(), "application/zip")},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["runId"]


def _migrate_as(client: TestClient, headers: dict, run_id: str) -> str:
    resp = client.post(
        "/api/migrate",
        json={
            "runId": run_id,
            "answers": {
                "project-type": "expo",
                "styling-engine": "nativewind",
                "navigation-library": "react-navigation",
            },
            "install": False,
            "runBundle": False,
        },
        headers=headers,
    )
    assert resp.status_code == 202, resp.text
    return resp.json()["jobId"]


def _await_job(client: TestClient, job_id: str, timeout: float = 120.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = client.get(f"/api/jobs/{job_id}", headers=ALPHA).json()
        if state["status"] in ("succeeded", "failed"):
            assert state["status"] == "succeeded", state.get("error")
            return state
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


# --- the run itself ----------------------------------------------------------


def test_the_owner_reaches_their_own_run(client) -> None:
    # The control: everything below must fail for a stranger and *only* because
    # they are a stranger, so the owner's path has to be green first.
    run_id = _upload_as(client, ALPHA)
    assert client.post("/api/plan", json={"runId": run_id}, headers=ALPHA).status_code == 200


def test_a_stranger_cannot_read_another_identitys_run(client) -> None:
    run_id = _upload_as(client, ALPHA)
    for endpoint in ("/api/parse", "/api/analyze", "/api/plan"):
        resp = client.post(endpoint, json={"runId": run_id}, headers=BRAVO)
        assert resp.status_code == 404, f"{endpoint}: {resp.status_code} {resp.text}"


def test_a_stranger_cannot_download_another_identitys_run(client) -> None:
    # The gate's headline case: one user must not be able to download another
    # user's source code. Migrated to completion first, so the owner's 200 is
    # real and the stranger's 404 cannot be "nothing emitted yet".
    run_id = _upload_as(client, ALPHA)
    job_id = _migrate_as(client, ALPHA, run_id)
    _await_job(client, job_id)

    assert client.get(f"/api/runs/{run_id}/download", headers=ALPHA).status_code == 200
    assert client.get(f"/api/runs/{run_id}/download", headers=BRAVO).status_code == 404


def test_a_stranger_cannot_migrate_into_another_identitys_run(client) -> None:
    # Writing into someone else's run is worse than reading it: the output dir
    # is what the owner downloads.
    run_id = _upload_as(client, ALPHA)
    resp = client.post("/api/migrate", json={"runId": run_id}, headers=BRAVO)
    assert resp.status_code == 404


def test_someone_elses_run_looks_exactly_like_a_run_that_does_not_exist(client) -> None:
    run_id = _upload_as(client, ALPHA)
    missing = "0" * 32
    stranger = client.get(f"/api/runs/{run_id}/download", headers=BRAVO)
    absent = client.get(f"/api/runs/{missing}/download", headers=BRAVO)
    assert stranger.status_code == absent.status_code == 404
    # Same status AND same message: the response must not answer "does this
    # runId exist?" for a caller who is not entitled to know.
    assert stranger.json()["detail"] == f"No such run: {run_id}"
    assert absent.json()["detail"] == f"No such run: {missing}"


# --- the job that runs in it -------------------------------------------------


def test_a_stranger_cannot_read_another_identitys_job(client) -> None:
    # A job carries the migration's stages, diagnostics and result — a detailed
    # description of the owner's codebase.
    run_id = _upload_as(client, ALPHA)
    job_id = _migrate_as(client, ALPHA, run_id)

    assert client.get(f"/api/jobs/{job_id}", headers=ALPHA).status_code == 200
    assert client.get(f"/api/jobs/{job_id}", headers=BRAVO).status_code == 404
    assert client.get(f"/api/jobs/{job_id}/events", headers=BRAVO).status_code == 404


# --- unowned runs ------------------------------------------------------------


def test_a_run_with_no_owner_is_unreachable_rather_than_public(client) -> None:
    # The CLI creates runs with no HTTP identity. Fail closed: nobody's run is
    # not everybody's run.
    run = workspace.new_run()
    assert run.owner is None
    for headers in (ALPHA, BRAVO):
        resp = client.post("/api/plan", json={"runId": run.runId}, headers=headers)
        assert resp.status_code == 404


# --- local-path mode ---------------------------------------------------------


def test_local_path_is_refused_unless_the_server_opts_in(client, monkeypatch) -> None:
    # `path` reads a directory of the server's filesystem chosen by the caller,
    # which is a way straight past ownership: a run's source lives at a path.
    monkeypatch.delenv("REJOX_ALLOW_LOCAL_PATH", raising=False)
    for endpoint in ("/api/parse", "/api/analyze", "/api/plan", "/api/migrate"):
        resp = client.post(endpoint, json={"path": str(SAMPLE)}, headers=ALPHA)
        assert resp.status_code == 403, f"{endpoint}: {resp.status_code}"
        assert "REJOX_ALLOW_LOCAL_PATH" in resp.json()["detail"]


def test_local_path_still_works_where_a_developer_opts_in(client, monkeypatch) -> None:
    monkeypatch.setenv("REJOX_ALLOW_LOCAL_PATH", "1")
    resp = client.post("/api/parse", json={"path": str(SAMPLE)}, headers=ALPHA)
    assert resp.status_code == 200, resp.text
