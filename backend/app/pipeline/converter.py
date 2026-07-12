"""Converter stage (Part 1 — deterministic).

Orchestrates the Node **codemod-worker** (ts-morph) from Python, exactly like
``parser.py`` orchestrates the parser-worker. Converts ONE React source file at
a time into React Native, returning a validated :class:`ConversionResult`. The
codemod is fully deterministic — no LLM. Anything it cannot safely transform is
recorded in ``unhandled`` for Part 2.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

from pydantic import ValidationError

from app.models.conversion import ConversionResult

# codemod-worker lives at backend/codemod-worker; this file is backend/app/pipeline.
WORKER_DIR = Path(__file__).resolve().parents[2] / "codemod-worker"
WORKER_ENTRY = WORKER_DIR / "dist" / "index.js"
CHECK_ENTRY = WORKER_DIR / "dist" / "check.js"

CONVERT_TIMEOUT_SECONDS = 120
BUILD_TIMEOUT_SECONDS = 600


class ConverterError(RuntimeError):
    """Raised when the codemod-worker cannot produce a valid ConversionResult."""


def _require_node() -> str:
    node = shutil.which("node")
    if node is None:
        raise ConverterError(
            "Node.js is required to run the codemod-worker but `node` was not "
            "found on PATH. Install Node 18+ and try again."
        )
    return node


def _run(cmd: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout)


def ensure_worker_built(force: bool = False) -> None:
    """Build the codemod-worker on first use (idempotent)."""
    if WORKER_ENTRY.exists() and not force:
        return

    _require_node()
    npm = shutil.which("npm")
    if npm is None:
        raise ConverterError(
            "`npm` was not found on PATH; it is required to build the "
            "codemod-worker on first run."
        )

    if not (WORKER_DIR / "node_modules").exists():
        install = _run([npm, "install"], WORKER_DIR, BUILD_TIMEOUT_SECONDS)
        if install.returncode != 0:
            raise ConverterError(
                "Failed to install codemod-worker dependencies.\n"
                f"stderr:\n{install.stderr}"
            )

    build = _run([npm, "run", "build"], WORKER_DIR, BUILD_TIMEOUT_SECONDS)
    if build.returncode != 0:
        raise ConverterError(f"Failed to build codemod-worker.\nstderr:\n{build.stderr}")
    if not WORKER_ENTRY.exists():
        raise ConverterError(
            f"codemod-worker build reported success but {WORKER_ENTRY} is missing."
        )


def convert_component(
    file: Path, options: Optional[dict[str, Any]] = None
) -> ConversionResult:
    """Convert a single React source file into React Native.

    Args:
        file: Path to the source ``.tsx``/``.jsx`` file to convert.
        options: The answered Ask-stage options (e.g.
            ``{"stylingEngine": "nativewind", "navigationLibrary": "react-navigation"}``).

    Raises:
        ConverterError: if the file is missing, the worker fails (including when
            it would emit syntactically invalid TS), or the output is not a valid
            ConversionResult.
    """
    source = Path(file).expanduser().resolve()
    if not source.is_file():
        raise ConverterError(f"Not a file: {source}")

    node = _require_node()
    ensure_worker_built()

    args = [node, str(WORKER_ENTRY), str(source), json.dumps(options or {})]
    try:
        proc = _run(args, WORKER_DIR, CONVERT_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        raise ConverterError(
            f"codemod-worker timed out after {CONVERT_TIMEOUT_SECONDS}s on {source}."
        ) from exc

    if proc.returncode != 0:
        raise ConverterError(
            "codemod-worker exited with a non-zero status "
            f"({proc.returncode}).\nstderr:\n{proc.stderr.strip()}"
        )

    try:
        raw = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        preview = proc.stdout[:500]
        raise ConverterError(
            "codemod-worker did not emit valid JSON.\n"
            f"JSON error: {exc}\nstdout (first 500 chars):\n{preview}\n"
            f"stderr:\n{proc.stderr.strip()}"
        ) from exc

    try:
        return ConversionResult.model_validate(raw)
    except ValidationError as exc:
        raise ConverterError(
            f"codemod-worker output failed ConversionResult validation:\n{exc}"
        ) from exc


def check_syntax(code: str) -> int:
    """Independently re-parse TS/TSX `code` and return its syntactic-error count.

    Writes to a temp file and runs the worker's ``check`` entry — used by tests
    to assert the conversion output is syntactically valid (zero errors).
    """
    import tempfile

    node = _require_node()
    ensure_worker_built()
    with tempfile.NamedTemporaryFile(
        "w", suffix=".tsx", delete=False, encoding="utf-8"
    ) as fh:
        fh.write(code)
        tmp = Path(fh.name)
    try:
        proc = _run([node, str(CHECK_ENTRY), str(tmp)], WORKER_DIR, CONVERT_TIMEOUT_SECONDS)
        if proc.returncode != 0:
            raise ConverterError(f"syntax check failed:\n{proc.stderr.strip()}")
        return int(proc.stdout.strip() or "0")
    finally:
        tmp.unlink(missing_ok=True)
