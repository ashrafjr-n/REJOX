"""API tests — the Upload → Migrate → Download round-trip over HTTP.

Uses FastAPI's TestClient against the real app. Migrate is now an async **job**:
POST returns 202 immediately, the work runs in the background, and we poll the
job to completion. install/tsc/Metro are skipped so the test stays fast and
offline while still proving the whole upload → job → download path.
"""

from __future__ import annotations

import io
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app


def _await_job(client, job_id: str, timeout: float = 60.0) -> dict:
    """Poll GET /api/jobs/{id} until it reaches a terminal state."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = client.get(f"/api/jobs/{job_id}").json()
        if state["status"] in ("succeeded", "failed"):
            return state
        time.sleep(0.1)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE = REPO_ROOT / "test-projects" / "sample-app"
_SKIP = {"node_modules", ".git", "dist", "build"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    return TestClient(app)


def _sample_zip(prefix: str = "sample-app") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(SAMPLE.rglob("*")):
            rel = path.relative_to(SAMPLE)
            if set(rel.parts) & _SKIP or not path.is_file():
                continue
            arc = f"{prefix}/{rel.as_posix()}" if prefix else rel.as_posix()
            zf.writestr(arc, path.read_bytes())
    return buf.getvalue()


def test_upload_rejects_non_zip(client) -> None:
    resp = client.post(
        "/api/upload",
        files={"file": ("bad.zip", b"not a zip", "application/zip")},
    )
    assert resp.status_code == 400
    assert "ZIP" in resp.json()["detail"]


def test_upload_migrate_download_round_trip(client) -> None:
    # 1. Upload — a wrapped archive, so root detection has to unwrap it.
    up = client.post(
        "/api/upload",
        files={"file": ("sample-app.zip", _sample_zip(), "application/zip")},
    )
    assert up.status_code == 200, up.text
    ingested = up.json()
    run_id = ingested["runId"]
    assert ingested["source"] == "zip"
    assert ingested["detectedRoot"].endswith("sample-app")
    assert ingested["candidateRoots"][0]["packageName"] == "sample-app"

    # 2. Migrate by runId — starts a background job (emit only; skip install/tsc/Metro).
    mig = client.post(
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
    )
    assert mig.status_code == 202, mig.text
    job_id = mig.json()["jobId"]
    assert mig.json()["status"] in ("queued", "running")

    state = _await_job(client, job_id)
    assert state["status"] == "succeeded", state.get("error")
    result = state["result"]
    assert result["runId"] == run_id
    assert any(f["sourceFile"] for f in result["emission"]["files"])

    # 3. Download — a real zip carrying the emitted RN project.
    dl = client.get(f"/api/runs/{run_id}/download")
    assert dl.status_code == 200
    assert dl.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(dl.content)) as zf:
        names = set(zf.namelist())
    assert "App.tsx" in names
    assert "package.json" in names
    assert "src/navigation/AppNavigator.tsx" in names
    # No vendor cruft leaked into the bundle.
    assert not any(n.startswith("node_modules/") for n in names)


def test_download_before_migrate_is_404(client) -> None:
    up = client.post(
        "/api/upload",
        files={"file": ("sample-app.zip", _sample_zip(), "application/zip")},
    )
    run_id = up.json()["runId"]
    dl = client.get(f"/api/runs/{run_id}/download")
    assert dl.status_code == 404


def test_download_unknown_run_is_404(client) -> None:
    assert client.get("/api/runs/deadbeefdeadbeef/download").status_code == 404


def test_parse_requires_exactly_one_source(client) -> None:
    # Neither path nor runId → validation error (422).
    assert client.post("/api/parse", json={}).status_code == 422
    # Both → also rejected.
    assert client.post(
        "/api/parse", json={"path": "/x", "runId": "abc123"}
    ).status_code == 422
