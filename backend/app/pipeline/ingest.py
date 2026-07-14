"""Ingestion — the Upload stage: land untrusted input, safely.

The product starts from a user upload; this module turns that upload (a ZIP or a
public GitHub URL) into files on disk inside a run workspace, then finds the
React project root within them.

**This is the trust boundary.** A ZIP is attacker-controlled, so extraction is
defensive, not convenient:

- **Path traversal** — an entry whose path contains ``..``, is absolute, or
  (after joining) resolves outside the extract root is rejected outright.
- **Symlinks** — an archived symlink that points outside the extract root is
  rejected; benign ones are skipped, never materialized.
- **Zip bombs** — extraction streams each entry through a running byte counter
  and aborts the moment the *actual* uncompressed total crosses the limit, so a
  lying header cannot get past it.
- **Size / count limits** — the compressed archive, the uncompressed total, and
  the number of entries each have a ceiling.
- **Vendor dirs** — ``node_modules`` / ``.git`` / ``dist`` / ``build`` in the
  archive are skipped; they are never source and would blow the limits.

GitHub ingestion shallow-clones (``--depth 1``) a validated public repo URL.
Private repos are a later feature and fail with a clear message.

    ingest_zip(data, run, *, limits=None) -> IngestedProject
    ingest_github(url, run, *, ref=None, timeout=...) -> IngestedProject
"""

from __future__ import annotations

import io
import json
import os
import shutil
import stat
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Optional
from urllib.parse import urlparse

from app.models.ingest import CandidateRoot, IngestedProject
from app.pipeline.workspace import Run

# --- limits (env-overridable) ------------------------------------------------

DEFAULT_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024      # 100 MB compressed upload
DEFAULT_MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024  # 500 MB expanded (bomb guard)
DEFAULT_MAX_FILE_COUNT = 20_000

# Directories that are never source and would otherwise dominate the payload.
SKIP_DIRS = {"node_modules", ".git", "dist", "build"}

_CLONE_TIMEOUT_SECONDS = 120
_READ_CHUNK = 64 * 1024


class IngestError(RuntimeError):
    """Raised for a rejected upload — traversal, a bomb, a bad URL, no React app."""


@dataclass(frozen=True)
class IngestLimits:
    maxArchiveBytes: int = DEFAULT_MAX_ARCHIVE_BYTES
    maxUncompressedBytes: int = DEFAULT_MAX_UNCOMPRESSED_BYTES
    maxFileCount: int = DEFAULT_MAX_FILE_COUNT

    @classmethod
    def from_env(cls) -> "IngestLimits":
        def _int(name: str, default: int) -> int:
            try:
                return int(os.environ[name])
            except (KeyError, ValueError):
                return default

        return cls(
            maxArchiveBytes=_int("REJOX_MAX_ARCHIVE_BYTES", DEFAULT_MAX_ARCHIVE_BYTES),
            maxUncompressedBytes=_int(
                "REJOX_MAX_UNCOMPRESSED_BYTES", DEFAULT_MAX_UNCOMPRESSED_BYTES
            ),
            maxFileCount=_int("REJOX_MAX_FILE_COUNT", DEFAULT_MAX_FILE_COUNT),
        )


# --- safe ZIP extraction -----------------------------------------------------


def _is_within(root: Path, candidate: Path) -> bool:
    """True iff ``candidate`` is ``root`` itself or lives under it (both resolved)."""
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _reject_traversal(name: str) -> PurePosixPath:
    """Validate an archive entry name; return its POSIX path or raise IngestError."""
    posix = name.replace("\\", "/")
    pure = PurePosixPath(posix)
    if pure.is_absolute() or posix.startswith("/"):
        raise IngestError(f"Rejected archive: absolute path in entry '{name}'.")
    # Windows-style drive absolute (C:\...) after backslash normalization.
    if len(posix) >= 2 and posix[1] == ":":
        raise IngestError(f"Rejected archive: absolute path in entry '{name}'.")
    if ".." in pure.parts:
        raise IngestError(f"Rejected archive: path traversal ('..') in entry '{name}'.")
    return pure


def _extract_zip(
    zf: zipfile.ZipFile, dest: Path, limits: IngestLimits
) -> tuple[int, int, list[str]]:
    """Stream every entry into ``dest`` under strict limits.

    Returns ``(fileCount, uncompressedBytes, warnings)``. Raises IngestError on
    any traversal, escaping symlink, or breached limit.
    """
    dest = dest.resolve()
    count = 0
    total = 0
    warnings: list[str] = []

    for info in zf.infolist():
        name = info.filename
        if name.endswith("/"):
            continue  # directory entry — created lazily when a file needs it

        pure = _reject_traversal(name)
        if set(pure.parts) & SKIP_DIRS:
            continue  # vendor/build dir — never source

        target = (dest / pure).resolve()
        if not _is_within(dest, target):
            raise IngestError(f"Rejected archive: entry '{name}' escapes the extract root.")

        mode = info.external_attr >> 16
        if stat.S_ISLNK(mode):
            link = zf.read(info).decode("utf-8", "replace")
            resolved = (target.parent / link).resolve()
            if not _is_within(dest, resolved):
                raise IngestError(
                    f"Rejected archive: symlink '{name}' → '{link}' points outside the extract root."
                )
            warnings.append(f"skipped in-tree symlink '{name}'")
            continue

        count += 1
        if count > limits.maxFileCount:
            raise IngestError(
                f"Rejected archive: more than {limits.maxFileCount} files (zip-bomb guard)."
            )

        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as out:
            while True:
                chunk = src.read(_READ_CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > limits.maxUncompressedBytes:
                    raise IngestError(
                        "Rejected archive: uncompressed size exceeds "
                        f"{limits.maxUncompressedBytes} bytes (zip-bomb guard)."
                    )
                out.write(chunk)

    if count == 0:
        raise IngestError("Rejected archive: it contained no extractable files.")
    return count, total, warnings


# --- React project-root detection --------------------------------------------


def detect_react_roots(root: Path) -> list[CandidateRoot]:
    """Find every directory under ``root`` whose ``package.json`` declares react.

    Sorted shallowest-first (then alphabetically), so the top result is the
    natural project root — the wrapping folder of an archive, or the one React
    app in a monorepo of packages.
    """
    root = root.resolve()
    candidates: list[CandidateRoot] = []
    for pkg in root.rglob("package.json"):
        rel_parts = pkg.relative_to(root).parts
        if set(rel_parts) & SKIP_DIRS:
            continue
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError, OSError):
            continue
        deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
        if "react" not in deps:
            continue
        rel_dir = pkg.parent.relative_to(root)
        candidates.append(
            CandidateRoot(
                path=str(rel_dir) if str(rel_dir) != "." else ".",
                packageName=str(data.get("name") or rel_dir.name or "unknown"),
                reactVersion=str(deps["react"]),
            )
        )

    def _depth(c: CandidateRoot) -> int:
        return 0 if c.path == "." else len(Path(c.path).parts)

    candidates.sort(key=lambda c: (_depth(c), c.path))
    return candidates


def _finalize(
    run: Run,
    source: str,
    file_count: int,
    size_bytes: int,
    warnings: list[str],
) -> IngestedProject:
    """Detect the React root, persist the manifest, and build the result."""
    candidates = detect_react_roots(run.source_dir)
    if not candidates:
        raise IngestError(
            "No React project found: no package.json in the upload declares a "
            "'react' dependency."
        )
    detected = (run.source_dir / candidates[0].path).resolve()
    result = IngestedProject(
        runId=run.runId,
        rootPath=str(run.source_dir.resolve()),
        source=source,  # type: ignore[arg-type]
        detectedRoot=str(detected),
        candidateRoots=candidates,
        fileCount=file_count,
        sizeBytes=size_bytes,
        warnings=warnings,
    )
    run.manifest_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
    return result


# --- public entrypoints ------------------------------------------------------


def ingest_zip(
    data: bytes, run: Run, *, limits: Optional[IngestLimits] = None
) -> IngestedProject:
    """Extract an uploaded ZIP into ``run.source`` and detect the React root."""
    limits = limits or IngestLimits.from_env()
    if len(data) > limits.maxArchiveBytes:
        raise IngestError(
            f"Rejected upload: archive is {len(data)} bytes, over the "
            f"{limits.maxArchiveBytes}-byte limit."
        )
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            count, size, warnings = _extract_zip(zf, run.source_dir, limits)
    except zipfile.BadZipFile as exc:
        raise IngestError(f"Rejected upload: not a valid ZIP archive ({exc}).") from exc
    return _finalize(run, "zip", count, size, warnings)


# --- GitHub ------------------------------------------------------------------


def _validate_github_url(url: str) -> str:
    """Accept only ``https://github.com/<owner>/<repo>`` (optional ``.git``)."""
    try:
        parsed = urlparse(url.strip())
    except ValueError as exc:
        raise IngestError(f"Not a valid URL: {url!r} ({exc}).") from exc
    if parsed.scheme not in ("http", "https"):
        raise IngestError("Only https GitHub URLs are supported.")
    if parsed.netloc.lower() not in ("github.com", "www.github.com"):
        raise IngestError(f"Not a GitHub URL: host '{parsed.netloc}' is not github.com.")
    segments = [s for s in parsed.path.split("/") if s]
    if len(segments) != 2:
        raise IngestError(
            "Not a GitHub repo URL: expected https://github.com/<owner>/<repo>."
        )
    owner, repo = segments
    repo = repo[:-4] if repo.endswith(".git") else repo
    if not owner or not repo:
        raise IngestError("Not a GitHub repo URL: empty owner or repository.")
    return f"https://github.com/{owner}/{repo}.git"


def _dir_stats(root: Path) -> tuple[int, int]:
    count = 0
    size = 0
    for p in root.rglob("*"):
        if set(p.relative_to(root).parts) & SKIP_DIRS:
            continue
        if p.is_file() and not p.is_symlink():
            count += 1
            try:
                size += p.stat().st_size
            except OSError:
                pass
    return count, size


def ingest_github(
    url: str,
    run: Run,
    *,
    ref: Optional[str] = None,
    limits: Optional[IngestLimits] = None,
    timeout: int = _CLONE_TIMEOUT_SECONDS,
) -> IngestedProject:
    """Shallow-clone a public GitHub repo into ``run.source`` and detect the root."""
    limits = limits or IngestLimits.from_env()
    clone_url = _validate_github_url(url)

    git = shutil.which("git")
    if git is None:
        raise IngestError("`git` was not found on PATH; it is required to clone repos.")

    cmd = [git, "clone", "--depth", "1"]
    if ref:
        cmd += ["--branch", ref]
    cmd += [clone_url, str(run.source_dir)]

    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},  # never block on auth
        )
    except subprocess.TimeoutExpired as exc:
        raise IngestError(f"git clone timed out after {timeout}s for {url}.") from exc

    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-3:]
        raise IngestError(
            "git clone failed. Only public repositories are supported (private "
            "repos need auth, which is a later feature). Check the URL"
            + (f" and branch '{ref}'" if ref else "")
            + ".\n"
            + "\n".join(tail)
        )

    # Drop vendor/VCS dirs a clone may carry before detection/limits.
    for junk in SKIP_DIRS:
        shutil.rmtree(run.source_dir / junk, ignore_errors=True)

    count, size = _dir_stats(run.source_dir)
    if count > limits.maxFileCount:
        raise IngestError(
            f"Rejected repo: more than {limits.maxFileCount} files after clone."
        )
    if size > limits.maxUncompressedBytes:
        raise IngestError(
            f"Rejected repo: checkout is {size} bytes, over the "
            f"{limits.maxUncompressedBytes}-byte limit."
        )
    return _finalize(run, "github", count, size, [])
