"""Run-workspace tests — creation, safe lookup, cleanup, TTL sweep."""

from __future__ import annotations

import os
import time

import pytest

from app.pipeline import workspace
from app.pipeline.workspace import WorkspaceError


@pytest.fixture
def ws(tmp_path, monkeypatch):
    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    return tmp_path


def test_new_run_creates_source_and_output(ws) -> None:
    run = workspace.new_run()
    assert run.source_dir.is_dir()
    assert run.output_dir.is_dir()
    # Round-trips through get_run.
    again = workspace.get_run(run.runId)
    assert again.root == run.root


def test_get_run_rejects_malformed_ids(ws) -> None:
    for bad in ["../escape", "a/b", "..", "not hex!", "", "x" * 200]:
        with pytest.raises(WorkspaceError):
            workspace.get_run(bad)


def test_get_run_missing_raises(ws) -> None:
    with pytest.raises(WorkspaceError):
        workspace.get_run("deadbeef")


def test_cleanup_removes_the_run(ws) -> None:
    run = workspace.new_run()
    assert run.root.is_dir()
    workspace.cleanup(run.runId)
    assert not run.root.exists()
    # Idempotent.
    workspace.cleanup(run.runId)


def test_sweep_reaps_only_old_runs(ws) -> None:
    fresh = workspace.new_run()
    old = workspace.new_run()
    # Age `old` past the TTL by back-dating its mtime.
    past = time.time() - 10_000
    os.utime(old.root, (past, past))

    removed = workspace.sweep(ttl_seconds=3600)
    assert old.runId in removed
    assert fresh.runId not in removed
    assert not old.root.exists()
    assert fresh.root.is_dir()
