"""End-to-end SSE migration — the real toolchain (npm install + tsc + Metro).

Marked ``slow``: this runs a full sample-app migration through the async job and
asserts the event stream tells the truth — stages in the real order, payload
counts matching what the engine actually did, and a terminal MigrationResult
carrying the real verdicts (tsc PASS, Metro PASS, 1 LLM call, 0 repair rounds).
Also proves the late-joiner and reconnect guarantees against the completed job.

Runs with the offline ``fake`` provider so the single navigator-shape LLM call
is deterministic and network-free.
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
    # Offline provider → the one navigator-shape LLM call is deterministic.
    monkeypatch.setenv("REJOX_AI_PROVIDER", "fake")
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


def _read_sse(client, url: str, headers=None, timeout: float = 300.0):
    """Read an SSE stream to its terminal event; return [(event_type, data)].

    ``timeout`` is generous: npm install / Metro export produce long silent gaps
    between events (no synthetic ticks are emitted to fill them)."""
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


@pytest.mark.slow
def test_full_migration_stream_tells_the_truth(client) -> None:
    # 1. Upload sample-app.
    up = client.post(
        "/api/upload",
        files={"file": ("sample-app.zip", _sample_zip(), "application/zip")},
    )
    assert up.status_code == 200, up.text
    run_id = up.json()["runId"]

    # 2. Start the migration job (full toolchain). Answers mirror what the Ask
    #    stage / frontend supplies (the recommended, known-good path).
    start = time.monotonic()
    mig = client.post(
        "/api/migrate",
        json={
            "runId": run_id,
            "answers": {
                "project-type": "expo",
                "styling-engine": "nativewind",
                "navigation-library": "react-navigation",
            },
            "install": True,
            "runBundle": True,
        },
    )
    post_elapsed = time.monotonic() - start
    assert mig.status_code == 202, mig.text
    assert post_elapsed < 1.0, f"POST took {post_elapsed:.3f}s — must be well under 1s"
    job_id = mig.json()["jobId"]

    # 3. Follow the SSE stream to completion.
    events = _read_sse(client, f"/api/jobs/{job_id}/events")

    # --- stages arrive in the true order ---
    order = [(t, d["stage"]) for t, d in events]
    assert order == [
        ("stage_started", "emit"),
        ("stage_completed", "emit"),
        ("stage_started", "install"),
        ("stage_completed", "install"),
        ("stage_started", "typecheck"),
        ("stage_completed", "typecheck"),
        ("stage_started", "bundle"),
        ("stage_completed", "bundle"),
        ("succeeded", "done"),
    ], order
    # No repair stage: validation passed on the first try (0 rounds).
    assert not any(stage == "repair" for _, stage in order)

    by = {(t, d["stage"]): d for t, d in events}

    # --- payload counts match what the engine actually did ---
    emit_done = by[("stage_completed", "emit")]
    assert emit_done["data"]["filesConverted"] > 0
    assert emit_done["data"]["navigatorShape"] == "tabs"  # the LLM's proposal
    assert emit_done["data"]["llmCalls"] == 1             # the single reasoning call

    install_done = by[("stage_completed", "install")]
    assert install_done["data"]["installed"] is True

    tsc_done = by[("stage_completed", "typecheck")]
    assert tsc_done["data"]["ran"] is True
    assert tsc_done["data"]["passed"] is True
    assert tsc_done["data"]["errorCount"] == 0

    metro_done = by[("stage_completed", "bundle")]
    assert metro_done["data"]["ran"] is True
    assert metro_done["data"]["passed"] is True

    # --- terminal event carries the real MigrationResult ---
    term_type, term = events[-1]
    assert term_type == "succeeded"
    result = term["result"]
    assert result["typecheckPassed"] is True
    assert result["bundlePassed"] is True
    assert result["validationPassed"] is True
    assert result["llmCalls"] == 1
    assert result["repairRounds"] == 0
    assert result["navigatorShape"] == "tabs"
    assert result["validatedScores"]["validatorPassed"] is True

    # The stream closed right after the terminal event.
    assert events[-1][0] == "succeeded"

    # 4. Late joiner: GET returns the SAME full picture the stream did.
    state = client.get(f"/api/jobs/{job_id}").json()
    assert state["status"] == "succeeded"
    assert [(e["type"], e["stage"]) for e in state["events"]] == order
    assert state["result"]["llmCalls"] == 1
    assert state["result"]["typecheckPassed"] is True

    # 5. Reconnect mid-stream loses nothing: resume from Last-Event-ID.
    total = events[-1][1]["seq"]
    resumed = _read_sse(
        client, f"/api/jobs/{job_id}/events", headers={"Last-Event-ID": str(total - 2)}
    )
    seqs = [d["seq"] for _, d in resumed]
    assert seqs == [total - 1, total]
    assert resumed[-1][0] == "succeeded"

    # 6. The emitted project is downloadable.
    dl = client.get(f"/api/runs/{run_id}/download")
    assert dl.status_code == 200
