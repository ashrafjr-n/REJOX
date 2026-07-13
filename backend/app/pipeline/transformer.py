"""Migration Engine — Deterministic Transformer.

First (and largest) part of the Migration Engine. Orchestrates the Node
**codemod-worker** (ts-morph) from Python, exactly like ``intelligence.py``
orchestrates the parser-worker. Transforms ONE React source file at a time into
React Native, returning a validated :class:`TransformResult`. Fully
deterministic — no LLM. Anything it cannot safely resolve is recorded in
``unhandled``: that list is the input contract of the AI Resolution Engine,
which handles only genuine-reasoning residue.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

from pydantic import ValidationError

from app.models.analysis import AnalysisReport
from app.models.knowledge_graph import KnowledgeGraph
from app.models.transformation import TransformResult

# codemod-worker lives at backend/codemod-worker; this file is backend/app/pipeline.
WORKER_DIR = Path(__file__).resolve().parents[2] / "codemod-worker"
WORKER_ENTRY = WORKER_DIR / "dist" / "index.js"
CHECK_ENTRY = WORKER_DIR / "dist" / "check.js"

CONVERT_TIMEOUT_SECONDS = 120
BUILD_TIMEOUT_SECONDS = 600


class TransformerError(RuntimeError):
    """Raised when the codemod-worker cannot produce a valid TransformResult."""


def _require_node() -> str:
    node = shutil.which("node")
    if node is None:
        raise TransformerError(
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
        raise TransformerError(
            "`npm` was not found on PATH; it is required to build the "
            "codemod-worker on first run."
        )

    if not (WORKER_DIR / "node_modules").exists():
        install = _run([npm, "install"], WORKER_DIR, BUILD_TIMEOUT_SECONDS)
        if install.returncode != 0:
            raise TransformerError(
                "Failed to install codemod-worker dependencies.\n"
                f"stderr:\n{install.stderr}"
            )

    build = _run([npm, "run", "build"], WORKER_DIR, BUILD_TIMEOUT_SECONDS)
    if build.returncode != 0:
        raise TransformerError(f"Failed to build codemod-worker.\nstderr:\n{build.stderr}")
    if not WORKER_ENTRY.exists():
        raise TransformerError(
            f"codemod-worker build reported success but {WORKER_ENTRY} is missing."
        )


# Any DOM attributes interface carries the DOM onClick — a component whose
# props extend one gets its DOM events renamed at every call site, consistent
# with the props-type transform rewriting the definition side (PressableProps).
_DOM_ATTRIBUTES_SUFFIX = "HTMLAttributes"
_DOM_EVENT_RENAMES = {"onClick": "onPress"}


def build_transform_options(
    kg: KnowledgeGraph,
    report: AnalysisReport,
    answers: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Derive the codemod-worker options from the Knowledge Graph + report.

    Everything here is graph-resolved — no guessing in the worker:

    - ``routes``: the normalized route table (absolute path → screen name +
      params), which makes ``<Link to>`` → ``navigation.navigate()`` a rule.
    - ``componentEvents``: project components whose props are DOM-derived
      (``propsExtends`` includes a ``*HTMLAttributes`` interface) or that
      declare an explicit ``onClick`` prop → rename DOM events consistently
      on both sides of the call.
    """
    options: dict[str, Any] = dict(answers or {})

    routes = []
    for mapping in report.routing.routes:
        path = mapping.path or "/"
        if not path.startswith("/"):
            path = f"/{path}"
        routes.append(
            {"path": path, "screen": mapping.screenName, "params": mapping.params}
        )
    if routes:
        options["routes"] = routes

    component_events: dict[str, dict[str, str]] = {}
    for comp in kg.components:
        dom_derived = any(
            base.endswith(_DOM_ATTRIBUTES_SUFFIX) for base in comp.propsExtends
        )
        explicit_onclick = any(p.name == "onClick" for p in comp.props)
        if dom_derived or explicit_onclick:
            component_events[comp.name] = dict(_DOM_EVENT_RENAMES)
    if component_events:
        options["componentEvents"] = component_events

    return options


def transform_component(
    file: Path, options: Optional[dict[str, Any]] = None
) -> TransformResult:
    """Transform a single React source file into React Native.

    Args:
        file: Path to the source ``.tsx``/``.jsx`` file to transform.
        options: The answered Ask-stage options plus graph-derived facts —
            build them with :func:`build_transform_options` (e.g.
            ``{"stylingEngine": "nativewind", "routes": [...], "componentEvents": {...}}``).

    Raises:
        TransformerError: if the file is missing, the worker fails (including when
            it would emit syntactically invalid TS), or the output is not a valid
            TransformResult.
    """
    source = Path(file).expanduser().resolve()
    if not source.is_file():
        raise TransformerError(f"Not a file: {source}")

    node = _require_node()
    ensure_worker_built()

    args = [node, str(WORKER_ENTRY), str(source), json.dumps(options or {})]
    try:
        proc = _run(args, WORKER_DIR, CONVERT_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        raise TransformerError(
            f"codemod-worker timed out after {CONVERT_TIMEOUT_SECONDS}s on {source}."
        ) from exc

    if proc.returncode != 0:
        raise TransformerError(
            "codemod-worker exited with a non-zero status "
            f"({proc.returncode}).\nstderr:\n{proc.stderr.strip()}"
        )

    try:
        raw = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        preview = proc.stdout[:500]
        raise TransformerError(
            "codemod-worker did not emit valid JSON.\n"
            f"JSON error: {exc}\nstdout (first 500 chars):\n{preview}\n"
            f"stderr:\n{proc.stderr.strip()}"
        ) from exc

    try:
        return TransformResult.model_validate(raw)
    except ValidationError as exc:
        raise TransformerError(
            f"codemod-worker output failed TransformResult validation:\n{exc}"
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
            raise TransformerError(f"syntax check failed:\n{proc.stderr.strip()}")
        return int(proc.stdout.strip() or "0")
    finally:
        tmp.unlink(missing_ok=True)
