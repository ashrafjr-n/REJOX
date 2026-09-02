"""Run workspaces — one isolated directory tree per migration.

Every migration is a *run* with a stable ``runId``. Its files live under a
single config-driven root::

    {WORKSPACE_ROOT}/{runId}/
        source/        # the ingested React project (upload lands here)
        output/        # the emitted React Native project (emit writes here)
        ingest.json    # the IngestedProject manifest (root detection, warnings)
        owner          # the identity this run belongs to (see below)

This is the *one* place run directories are created, resolved, and reaped — the
API (uploads) and the CLI (local-path runs) both go through it, so there is a
single code path, not a special case for uploads. ``runId`` is a plain hex
token and is validated on every lookup, so it can never be used to escape the
workspace root via a crafted path.

**Ownership.** A run holds someone's source code and the project emitted from
it, so it belongs to exactly one identity. That identity is recorded here, in a
file inside the run, because it has to outlive the request that created it and
be readable from a process that never saw that request (the API creates a run;
an rq worker executes it). It is written once, at creation, and never rewritten
— a run does not change hands. A run created without an owner (the CLI, which
has no HTTP identity) is owned by nobody, and :meth:`Run.owned_by` answers
``False`` for every caller: unowned means unreachable over HTTP, never public.

Environment:
  ``REJOX_WORKSPACE_ROOT`` — root for all runs (default: ``backend/.rejox-workspaces``).
"""

from __future__ import annotations

import hmac
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

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

# The file holding the run's owning identity. A bare filename, never a path the
# caller influences, and deliberately not inside source/ or output/ so it is
# neither ingested nor shipped in the download.
_OWNER_FILE = "owner"


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

    @property
    def owner(self) -> Optional[str]:
        """The identity this run belongs to, or ``None`` if it has no owner.

        Read from disk on every call rather than captured at construction: the
        process asking is often not the process that wrote it.
        """
        try:
            return (self.root / _OWNER_FILE).read_text().strip() or None
        except OSError:
            return None

    def owned_by(self, identity: str) -> bool:
        """Whether ``identity`` owns this run.

        Fails closed: an unowned run belongs to nobody, so this is ``False`` for
        every caller rather than ``True`` for all of them. Compared in constant
        time — an owner is derived from an API key's digest.
        """
        owner = self.owner
        if owner is None:
            return False
        return hmac.compare_digest(owner, identity)


def new_run(owner: Optional[str] = None) -> Run:
    """Create a fresh run with a unique id and its ``source``/``output`` dirs.

    ``owner`` is the identity the run belongs to (see the module docstring).
    Written before the run has any content, so a run is never readable in the
    window between its directory existing and its owner being known.
    """
    run_id = uuid.uuid4().hex
    root = workspace_root() / run_id
    run = Run(runId=run_id, root=root)
    root.mkdir(parents=True, exist_ok=True)
    if owner:
        (root / _OWNER_FILE).write_text(owner)
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


def expired_runs(
    ttl_seconds: int = DEFAULT_TTL_SECONDS, *, now: float | None = None
) -> list[str]:
    """The run ids past their window — the ONE definition of "expired".

    Both the sweeper and ``rejox sweep --dry-run`` ask this, so a dry run cannot
    promise to delete something the real sweep would never touch. It did once:
    the dry run had its own copy of the predicate without the run-id filter, and
    named a directory the sweep then left in place (observed at gate B7,
    2026-09-03). A retention preview that overstates what it will delete is
    worse than no preview.

    Age is measured from the run directory's mtime, which ``new_run`` sets at
    creation and later writes refresh. Directories whose names are not run ids
    are never candidates: the workspace root is shared, and this deletes trees.
    """
    now = time.time() if now is None else now
    return sorted(
        child.name
        for child in workspace_root().iterdir()
        if child.is_dir()
        and _RUN_ID_RE.match(child.name)
        and now - child.stat().st_mtime > ttl_seconds
    )


def sweep(ttl_seconds: int = DEFAULT_TTL_SECONDS, *, now: float | None = None) -> list[str]:
    """Reap runs whose directory is older than ``ttl_seconds``.

    Returns the ids removed.
    """
    root = workspace_root()
    removed: list[str] = []
    for run_id in expired_runs(ttl_seconds, now=now):
        shutil.rmtree(root / run_id, ignore_errors=True)
        removed.append(run_id)
    return removed
