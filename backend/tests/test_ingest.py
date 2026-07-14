"""Ingestion tests — real archives, real security guards.

The malicious cases build *actual* hostile ZIP bytes (path traversal, an
escaping symlink, a zip bomb, an oversize/too-many-files archive) and assert the
extractor rejects them — no mocks. Root detection is exercised against a flat
archive, one wrapped in a top-level folder, a monorepo subdirectory, and an
archive with no React project.
"""

from __future__ import annotations

import io
import os
import stat
import zipfile
from pathlib import Path

import pytest

from app.pipeline import workspace
from app.pipeline.ingest import (
    IngestError,
    IngestLimits,
    _validate_github_url,
    ingest_github,
    ingest_zip,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE = REPO_ROOT / "test-projects" / "sample-app"
_SKIP = {"node_modules", ".git", "dist", "build"}


@pytest.fixture
def ws(tmp_path, monkeypatch):
    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    return tmp_path


# --- zip builders ------------------------------------------------------------


def _zip_bytes(entries: dict[str, bytes | str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in entries.items():
            zf.writestr(name, content)
    return buf.getvalue()


def _zip_sample_app(prefix: str = "") -> bytes:
    """Zip the real sample-app source (minus vendor dirs), optionally wrapped."""
    entries: dict[str, bytes | str] = {}
    for path in sorted(SAMPLE.rglob("*")):
        rel = path.relative_to(SAMPLE)
        if set(rel.parts) & _SKIP or not path.is_file():
            continue
        arc = f"{prefix}/{rel.as_posix()}" if prefix else rel.as_posix()
        entries[arc] = path.read_bytes()
    return _zip_bytes(entries)


# --- root detection ----------------------------------------------------------


def test_flat_archive_detects_root_at_top(ws) -> None:
    run = workspace.new_run()
    result = ingest_zip(_zip_sample_app(), run)
    assert result.source == "zip"
    assert Path(result.detectedRoot) == run.source_dir.resolve()
    assert result.candidateRoots[0].path == "."
    assert result.candidateRoots[0].packageName == "sample-app"
    assert result.fileCount > 0
    # The manifest was persisted for later runId-mode calls.
    assert run.manifest_path.is_file()


def test_wrapped_archive_detects_nested_root(ws) -> None:
    run = workspace.new_run()
    result = ingest_zip(_zip_sample_app(prefix="sample-app"), run)
    detected = Path(result.detectedRoot)
    assert detected == (run.source_dir / "sample-app").resolve()
    assert (detected / "package.json").is_file()


def test_monorepo_resolves_to_the_react_subdir(ws) -> None:
    run = workspace.new_run()
    data = _zip_bytes({
        "package.json": '{"name": "monorepo", "private": true, "workspaces": ["apps/*"]}',
        "apps/web/package.json": '{"name": "web", "dependencies": {"react": "^19.0.0"}}',
        "apps/web/src/main.tsx": "export const x = 1;",
        "packages/ui/package.json": '{"name": "ui", "dependencies": {"clsx": "^2.0.0"}}',
    })
    result = ingest_zip(data, run)
    assert Path(result.detectedRoot) == (run.source_dir / "apps/web").resolve()
    assert [c.path for c in result.candidateRoots] == ["apps/web"]


def test_no_react_project_fails_cleanly(ws) -> None:
    run = workspace.new_run()
    data = _zip_bytes({"package.json": '{"name": "x", "dependencies": {"lodash": "^4.0.0"}}'})
    with pytest.raises(IngestError, match="No React project found"):
        ingest_zip(data, run)


# --- security guards ---------------------------------------------------------


def test_path_traversal_is_rejected(ws) -> None:
    run = workspace.new_run()
    data = _zip_bytes({"../evil.txt": "pwned", "package.json": "{}"})
    with pytest.raises(IngestError, match="traversal"):
        ingest_zip(data, run)
    # Nothing escaped the workspace.
    assert not (ws / "evil.txt").exists()


def test_absolute_path_is_rejected(ws) -> None:
    run = workspace.new_run()
    data = _zip_bytes({"/etc/evil.txt": "pwned"})
    with pytest.raises(IngestError, match="absolute path"):
        ingest_zip(data, run)


def test_escaping_symlink_is_rejected(ws) -> None:
    run = workspace.new_run()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("package.json", '{"dependencies": {"react": "1"}}')
        zi = zipfile.ZipInfo("evil-link")
        zi.external_attr = (stat.S_IFLNK | 0o777) << 16
        zf.writestr(zi, "../../../../etc/passwd")
    with pytest.raises(IngestError, match="symlink"):
        ingest_zip(buf.getvalue(), run)


def test_zip_bomb_uncompressed_limit(ws) -> None:
    run = workspace.new_run()
    # 4 MB of zeros compresses to a few KB; cap the uncompressed total at 1 MB.
    data = _zip_bytes({
        "package.json": '{"dependencies": {"react": "1"}}',
        "bomb.bin": b"\0" * (4 * 1024 * 1024),
    })
    limits = IngestLimits(maxUncompressedBytes=1 * 1024 * 1024)
    with pytest.raises(IngestError, match="uncompressed size exceeds"):
        ingest_zip(data, run, limits=limits)


def test_oversize_archive_is_rejected(ws) -> None:
    run = workspace.new_run()
    data = _zip_sample_app()  # real bytes, well over the tiny cap below
    with pytest.raises(IngestError, match="over the"):
        ingest_zip(data, run, limits=IngestLimits(maxArchiveBytes=64))


def test_too_many_files_is_rejected(ws) -> None:
    run = workspace.new_run()
    entries = {f"src/file{i}.ts": "export const x = 1;" for i in range(30)}
    entries["package.json"] = '{"dependencies": {"react": "1"}}'
    data = _zip_bytes(entries)
    with pytest.raises(IngestError, match="more than 5 files"):
        ingest_zip(data, run, limits=IngestLimits(maxFileCount=5))


def test_vendor_dirs_are_skipped(ws) -> None:
    run = workspace.new_run()
    data = _zip_bytes({
        "package.json": '{"name": "x", "dependencies": {"react": "1"}}',
        "src/App.tsx": "export const A = 1;",
        "node_modules/react/index.js": "module.exports = {};",
        "dist/bundle.js": "console.log(1);",
    })
    result = ingest_zip(data, run)
    # node_modules / dist never landed on disk.
    assert not (run.source_dir / "node_modules").exists()
    assert not (run.source_dir / "dist").exists()
    assert (run.source_dir / "src" / "App.tsx").is_file()
    assert result.fileCount == 2  # package.json + App.tsx only


def test_not_a_zip_is_rejected(ws) -> None:
    run = workspace.new_run()
    with pytest.raises(IngestError, match="not a valid ZIP"):
        ingest_zip(b"this is not a zip file", run)


# --- GitHub URL validation (offline) -----------------------------------------


def test_github_url_validation_accepts_and_normalizes() -> None:
    assert _validate_github_url("https://github.com/facebook/react") == (
        "https://github.com/facebook/react.git"
    )
    assert _validate_github_url("https://github.com/facebook/react.git") == (
        "https://github.com/facebook/react.git"
    )


@pytest.mark.parametrize(
    "bad",
    [
        "https://gitlab.com/a/b",
        "https://github.com/only-one-segment",
        "https://github.com/a/b/c",
        "ftp://github.com/a/b",
        "not a url at all",
    ],
)
def test_github_url_validation_rejects_bad(bad) -> None:
    with pytest.raises(IngestError):
        _validate_github_url(bad)


# --- GitHub clone (network-dependent, skipped by default) --------------------


@pytest.mark.network
@pytest.mark.skipif(
    not os.environ.get("REJOX_RUN_NETWORK_TESTS"),
    reason="network test — set REJOX_RUN_NETWORK_TESTS=1 to run it.",
)
def test_github_clone_lands_files_and_reports_no_react(ws) -> None:
    """A real shallow clone of a tiny public repo actually fetches files; that
    repo has no package.json, so ingestion then fails with the clean 'no React
    project' error — proving both the clone and the honest-failure path."""
    run = workspace.new_run()
    with pytest.raises(IngestError, match="No React project found"):
        ingest_github("https://github.com/octocat/Hello-World", run)
    # The clone populated the workspace before detection rejected it.
    assert any(run.source_dir.iterdir())
    assert not (run.source_dir / ".git").exists()  # VCS dir stripped
