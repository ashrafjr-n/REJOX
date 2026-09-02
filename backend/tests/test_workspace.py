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


def test_the_owner_survives_a_fresh_handle_to_the_same_run(ws) -> None:
    # The API creates the run; an rq worker in another process resolves it. The
    # owner has to be on disk, not held by the object that created it.
    run = workspace.new_run("key:abc123")
    assert workspace.get_run(run.runId).owner == "key:abc123"
    assert workspace.get_run(run.runId).owned_by("key:abc123")
    assert not workspace.get_run(run.runId).owned_by("key:someone-else")


def test_a_run_with_no_owner_belongs_to_nobody(ws) -> None:
    # Fails closed: an unowned run is not a public run.
    run = workspace.new_run()
    assert run.owner is None
    assert not run.owned_by("key:abc123")
    assert not run.owned_by("")


def test_the_owner_is_not_shipped_in_the_run_source_or_output(ws) -> None:
    run = workspace.new_run("key:abc123")
    assert (run.root / "owner").is_file()
    assert not (run.source_dir / "owner").exists()
    assert not (run.output_dir / "owner").exists()


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


def test_the_sweep_preview_names_exactly_what_the_sweep_deletes(ws) -> None:
    """Observed at gate B7 (2026-09-03): `rejox sweep --dry-run` had its own copy
    of the expiry predicate, without the run-id filter, so it announced it would
    reap a directory the real sweep then left in place. A retention preview that
    overstates what it deletes is worse than no preview at all."""
    old = workspace.new_run()
    past = time.time() - 10_000
    os.utime(old.root, (past, past))

    # Something in the workspace root that is NOT a run — a probe, a stray dir.
    not_a_run = workspace.workspace_root() / "gate-probe"
    not_a_run.mkdir()
    os.utime(not_a_run, (past, past))

    previewed = workspace.expired_runs(3600)
    removed = workspace.sweep(ttl_seconds=3600)

    assert previewed == removed
    assert "gate-probe" not in previewed
    assert not_a_run.is_dir()
    assert old.runId in removed
