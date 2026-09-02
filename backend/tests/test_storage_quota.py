"""Gate E1 — one identity cannot fill the disk.

The arithmetic that made this necessary, recorded so it can be recomputed:
10 uploads/minute x 500 MB expanded = 300 GB/hour for one identity, held for a
24h retention window, with nothing checking free space. The rate limit caps
requests and the archive guard caps one upload; neither caps their sum.
"""

from __future__ import annotations

import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import security
from app.main import app
from app.pipeline import workspace

CODE = "invite-alpha"


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    monkeypatch.setenv("REJOX_INVITE_CODES", CODE)
    monkeypatch.setenv("REJOX_SESSION_SECRET", "test-secret-not-a-real-one")
    monkeypatch.delenv("REJOX_API_KEYS", raising=False)
    monkeypatch.delenv("REJOX_ALLOW_ANONYMOUS", raising=False)
    return tmp_path


@pytest.fixture
def client(env):
    c = TestClient(app, base_url="https://testserver")
    c.post("/api/session", json={"code": CODE})
    return c


def _zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("app/package.json", '{"name":"a","dependencies":{"react":"18"}}')
        zf.writestr("app/src/App.jsx", "export default function App(){return <div/>}")
    return buf.getvalue()


def _upload(client):
    return client.post(
        "/api/upload", files={"file": ("a.zip", _zip(), "application/zip")}
    )


def test_an_upload_within_quota_is_accepted(client) -> None:
    assert _upload(client).status_code == 200


def test_footprint_counts_only_this_identity(env) -> None:
    mine = workspace.new_run("acct:mine")
    (mine.source_dir / "big.txt").write_bytes(b"x" * 4096)
    theirs = workspace.new_run("acct:theirs")
    (theirs.source_dir / "big.txt").write_bytes(b"x" * 8192)

    assert workspace.footprint("acct:mine") >= 4096
    assert workspace.footprint("acct:mine") < 8192
    # An unowned run belongs to nobody and is charged to nobody.
    workspace.new_run()
    assert workspace.footprint("") == 0


def test_a_full_quota_refuses_with_413_and_says_why(client, monkeypatch) -> None:
    assert _upload(client).status_code == 200
    monkeypatch.setenv("REJOX_ACCOUNT_QUOTA_BYTES", "1")

    resp = _upload(client)
    assert resp.status_code == 413
    detail = resp.json()["detail"]
    # The caller can act on this one: it is THEIR data, and it expires.
    assert "quota" in detail.lower()
    assert "retention window" in detail


def test_a_full_disk_refuses_with_503_not_413(client, monkeypatch) -> None:
    """A server out of disk is not the caller's fault, and telling them their
    upload was too large would send them off fixing the wrong thing."""
    monkeypatch.setattr(workspace, "free_bytes", lambda: 1)

    resp = _upload(client)
    assert resp.status_code == 503
    assert "server is low on storage" in resp.json()["detail"]


def test_the_disk_check_runs_before_the_quota_check(client, monkeypatch) -> None:
    """Both conditions at once must report the one the operator has to fix."""
    monkeypatch.setattr(workspace, "free_bytes", lambda: 1)
    monkeypatch.setenv("REJOX_ACCOUNT_QUOTA_BYTES", "1")
    assert _upload(client).status_code == 503


def test_the_documented_defaults_are_what_ships(env) -> None:
    """2 GB is ~50 runs at the ~40 MB/run measured at gate B7. If either number
    changes, docs/SECURITY.md's arithmetic needs changing with it."""
    assert security.account_quota_bytes() == 2 * 1024 * 1024 * 1024
    assert security.min_free_bytes() == 2 * 1024 * 1024 * 1024
