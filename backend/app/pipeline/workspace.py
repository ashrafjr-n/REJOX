"""Run workspaces — one isolated directory tree per migration.

Every migration is a *run* with a stable ``runId``. Its files live under a
single config-driven root::

    {WORKSPACE_ROOT}/{runId}/
        source/        # the ingested React project (upload lands here)
        output/        # the emitted React Native project (emit writes here)
        ingest.json    # the IngestedProject manifest (root detection, warnings)

This is the *one* place run directories are created, resolved, and reaped — the
API (uploads) and the CLI (local-path runs) both go through it, so there is a
single code path, not a special case for uploads. ``runId`` is a plain hex
token and is validated on every lookup, so it can never be used to escape the
workspace root via a crafted path.

Environment:
  ``REJOX_WORKSPACE_ROOT`` — root for all runs (default: ``backend/.rejox-workspaces``).
"""

from __future__ import annotations

import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

# workspace.py is backend/app/pipeline/workspace.py → parents[2] == backend.
_DEFAULT_WORKSPACE_ROOT = Path(__file__).resolve().parents[2] / ".rejox-workspaces"

# A runId is a hex token (uuid4().hex). Validated on every lookup so a runId
# taken from an HTTP path can never contain "/" or ".." and escape the root.
_RUN_ID_RE = re.compile(r"^[0-9a-f]{8,64}$")

# Default TTL for the sweep: runs older than this are eligible for reaping.
# A run holds someone's uploaded source and the project emitted from it, so this
# is a data-retention window, not a disk-space convenience. Override with
# REJOX_RUN_TTL_SECONDS.
DEFAULT_TTL_SECONDS = 24 * 60 * 60


def ttl_seconds() -> int:
    """The configured retention window for run workspaces."""
    raw = os.environ.get("REJOX_RUN_TTL_SECONDS", "").strip()
    if not raw:
        return DEFAULT_TTL_SECONDS
    try:
        return max(0, int(raw))
    except ValueError:
        return DEFAULT_TTL_SECONDS


class WorkspaceError(RuntimeError):
    """Raised for an invalid runId or a missing run directory."""


def workspace_root() -> Path:
    """The configured root for all run workspaces (created on demand)."""
    root = Path(os.environ.get("REJOX_WORKSPACE_ROOT", str(_DEFAULT_WORKSPACE_ROOT)))
    root = root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _validate_run_id(run_id: str) -> str:
    if not isinstance(run_id, str) or not _RUN_ID_RE.match(run_id):
        raise WorkspaceError(f"Invalid runId: {run_id!r}")
    return run_id


@dataclass(frozen=True)
class Run:
    """Handle to one run's directory tree. Cheap to construct; holds no state."""

    runId: str
    root: Path

    @property
    def source_dir(self) -> Path:
        return self.root / "source"

    @property
    def output_dir(self) -> Path:
        return self.root / "output"

    @property
    def manifest_path(self) -> Path:
        return self.root / "ingest.json"


def new_run() -> Run:
    """Create a fresh run with a unique id and its ``source``/``output`` dirs."""
    run_id = uuid.uuid4().hex
    root = workspace_root() / run_id
    run = Run(runId=run_id, root=root)
    run.source_dir.mkdir(parents=True, exist_ok=True)
    run.output_dir.mkdir(parents=True, exist_ok=True)
    return run


def get_run(run_id: str) -> Run:
    """Resolve an existing run by id. Raises if the id is malformed or missing."""
    _validate_run_id(run_id)
    root = workspace_root() / run_id
    if not root.is_dir():
        raise WorkspaceError(f"No such run: {run_id}")
    return Run(runId=run_id, root=root)


def cleanup(run_id: str) -> None:
    """Delete a run's entire directory tree. Idempotent."""
    _validate_run_id(run_id)
    shutil.rmtree(workspace_root() / run_id, ignore_errors=True)


def sweep(ttl_seconds: int = DEFAULT_TTL_SECONDS, *, now: float | None = None) -> list[str]:
    """Reap runs whose directory is older than ``ttl_seconds``.

    Returns the ids removed. Age is measured from the run directory's mtime,
    which ``new_run`` sets at creation and later writes refresh.
    """
    now = time.time() if now is None else now
    removed: list[str] = []
    root = workspace_root()
    for child in root.iterdir():
        if not child.is_dir() or not _RUN_ID_RE.match(child.name):
            continue
        if now - child.stat().st_mtime > ttl_seconds:
            shutil.rmtree(child, ignore_errors=True)
            removed.append(child.name)
    return removed
