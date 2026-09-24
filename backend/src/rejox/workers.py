"""The bundled Node workers — the one place Python finds and runs them.

``rejox/_workers/parser.js`` (Project Intelligence Engine) and
``rejox/_workers/codemod.js`` (Deterministic Transformer) are esbuild bundles:
self-contained, no ``node_modules``, identical on every machine. They are written
by ``scripts/bundle_workers.py`` in a checkout and by the build hook in a wheel.

Nothing is installed or built at run time. A missing bundle or an unusable Node
is an environment problem and is reported as one (:class:`WorkerUnavailable`),
never repaired behind the user's back.
"""

from __future__ import annotations

import functools
import re
import shutil
import subprocess
from pathlib import Path
from typing import Literal

WORKERS_DIR = Path(__file__).resolve().parent / "_workers"
MIN_NODE_MAJOR = 20

Worker = Literal["parser", "codemod"]


class WorkerUnavailable(RuntimeError):
    """Node is missing or too old, or a worker bundle is not installed."""


@functools.cache
def node() -> str:
    """Path to a usable ``node`` (>= MIN_NODE_MAJOR), checked once per process."""
    path = shutil.which("node")
    if path is None:
        raise WorkerUnavailable(
            f"Node.js {MIN_NODE_MAJOR}+ is required but `node` was not found on PATH. "
            "Install it from https://nodejs.org and try again."
        )
    version = subprocess.run([path, "--version"], capture_output=True, text=True).stdout.strip()
    match = re.match(r"v(\d+)\.", version)
    if match is None or int(match.group(1)) < MIN_NODE_MAJOR:
        raise WorkerUnavailable(
            f"Node.js {MIN_NODE_MAJOR}+ is required; found {version or 'an unknown version'} "
            f"at {path}."
        )
    return path


def bundle(worker: Worker) -> Path:
    path = WORKERS_DIR / f"{worker}.js"
    if not path.is_file():
        raise WorkerUnavailable(
            f"The {worker} worker bundle is missing ({path}). Reinstall rejox, or in a "
            "checkout run `python scripts/bundle_workers.py` from backend/."
        )
    return path


def run(worker: Worker, args: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    """Run ``node <worker>.js *args`` and capture its text output.

    Raises ``subprocess.TimeoutExpired`` unchanged; callers name the timeout.
    """
    return subprocess.run(
        [node(), str(bundle(worker)), *args],
        cwd=str(WORKERS_DIR),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
