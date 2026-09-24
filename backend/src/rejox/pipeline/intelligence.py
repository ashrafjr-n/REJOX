"""Project Intelligence Engine.

Parser + dependency scanner + AST builder + metadata extractor + graph builder.
Orchestrates the deterministic Node parser-worker (ts-morph) from Python. The
worker is the single source of parsing truth — Python never parses JS/TS itself.
This module runs the worker over a project path, captures its stdout JSON, and
validates it into a :class:`KnowledgeGraph` pydantic model.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from pydantic import ValidationError

from rejox import workers
from rejox.models.knowledge_graph import KnowledgeGraph

REPO_ROOT = Path(__file__).resolve().parents[4]

# The committed benchmark and the graph fixture generated from it. Named here so
# the generator (`rejox export-graph`) and the staleness gate that guards the
# file cannot drift apart on where either one lives.
BENCHMARK_PROJECT = REPO_ROOT / "test-projects" / "sample-app"
FIXTURES_DIR = REPO_ROOT / "backend" / "tests" / "fixtures"

# Generous ceiling; parsing is CPU-bound and local.
PARSE_TIMEOUT_SECONDS = 300


class IntelligenceError(RuntimeError):
    """Raised when the parser-worker cannot produce a valid Knowledge Graph."""


def build_knowledge_graph(path: Path) -> KnowledgeGraph:
    """Parse a React project into a validated Knowledge Graph.

    Args:
        path: Path to the root of a React project (must contain the source to
            parse; a ``package.json`` is expected but not strictly required).

    Raises:
        IntelligenceError: if the path is invalid, the worker fails, its output is not
            valid JSON, or the output does not match the Knowledge Graph schema.
    """
    project_path = Path(path).expanduser().resolve()
    if not project_path.is_dir():
        raise IntelligenceError(f"Not a directory: {project_path}")

    try:
        proc = workers.run("parser", [str(project_path)], PARSE_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        raise IntelligenceError(
            f"parser-worker timed out after {PARSE_TIMEOUT_SECONDS}s on {project_path}."
        ) from exc

    if proc.returncode != 0:
        raise IntelligenceError(
            "parser-worker exited with a non-zero status "
            f"({proc.returncode}).\nstderr:\n{proc.stderr.strip()}"
        )

    try:
        raw = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        preview = proc.stdout[:500]
        raise IntelligenceError(
            "parser-worker did not emit valid JSON.\n"
            f"JSON error: {exc}\nstdout (first 500 chars):\n{preview}\n"
            f"stderr:\n{proc.stderr.strip()}"
        ) from exc

    try:
        return KnowledgeGraph.model_validate(raw)
    except ValidationError as exc:
        raise IntelligenceError(
            f"parser-worker output failed Knowledge Graph validation:\n{exc}"
        ) from exc


# --- committed graph fixtures ------------------------------------------------


def _portable_root(project_path: Path, repo_root: Path) -> str:
    """The value to commit as ``project.root``.

    Repo-relative for a project inside the repo (the benchmark case); otherwise
    just the directory name. Never an absolute path: that is the home directory
    of whichever machine ran the parser, and committing it makes the file read
    as if it belonged to one developer.
    """
    resolved = project_path.expanduser().resolve()
    try:
        return resolved.relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return resolved.name


def render_graph_fixture(
    kg: KnowledgeGraph, *, project_path: Path, repo_root: Path = REPO_ROOT
) -> str:
    """Serialize ``kg`` as a committed test fixture.

    Deterministic bytes, so the only reason such a file ever changes is that the
    graph itself changed — which is what lets a test compare a fresh parse
    against the committed copy and fail when it has gone stale. Consumers of the
    fixture pass ``source_root`` explicitly, so the portable ``project.root``
    written here is never read as a real location.
    """
    data = kg.model_dump(mode="json")
    data["project"]["root"] = _portable_root(project_path, repo_root)
    return json.dumps(data, indent=2) + "\n"
