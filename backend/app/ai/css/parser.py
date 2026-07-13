"""CSS Module resolver — Node bridge.

Parsing (postcss) and the component AST rewrite (ts-morph) both live in the
codemod-worker, orchestrated from Python exactly like the transformer. Python
never parses CSS or JSX itself; these two thin wrappers are the only seam.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from pydantic import ValidationError

from app.ai.css.models import ParsedCss
from app.pipeline.transformer import (
    TransformerError,
    _require_node,
    _run,
    ensure_worker_built,
)

WORKER_DIR = Path(__file__).resolve().parents[3] / "codemod-worker"
CSS_ENTRY = WORKER_DIR / "dist" / "css.js"
CSSMODULE_ENTRY = WORKER_DIR / "dist" / "cssmodule.js"

_TIMEOUT = 120


def _ensure_css_worker_built() -> None:
    """Build the worker, then force a rebuild if the CSS entries are missing.

    ``ensure_worker_built`` keys off ``index.js`` only; the CSS entries
    (``css.js``/``cssmodule.js``) are newer, so a stale ``dist/`` that predates
    them would otherwise not be rebuilt."""
    ensure_worker_built()
    if not (CSS_ENTRY.exists() and CSSMODULE_ENTRY.exists()):
        ensure_worker_built(force=True)


def parse_css_module(path: Path | str) -> ParsedCss:
    """Parse a ``.module.css`` file into a structured AST via postcss (Node)."""
    source = Path(path).expanduser().resolve()
    if not source.is_file():
        raise TransformerError(f"Not a file: {source}")
    node = _require_node()
    _ensure_css_worker_built()

    proc = _run([node, str(CSS_ENTRY), str(source)], WORKER_DIR, _TIMEOUT)
    if proc.returncode != 0:
        raise TransformerError(f"css-worker failed on {source}:\n{proc.stderr.strip()}")
    try:
        return ParsedCss.model_validate_json(proc.stdout)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise TransformerError(f"css-worker output invalid for {source}:\n{exc}") from exc


def rewrite_component(
    component_path: Path | str, module_specifier: str, style_body: str
) -> str:
    """Rewrite the component that imported ``module_specifier``: drop the CSS
    import, inline ``StyleSheet.create(style_body)`` under the same local name,
    and flip ``className={styles.X}`` → ``style={styles.X}`` (ts-morph)."""
    comp = Path(component_path).expanduser().resolve()
    if not comp.is_file():
        raise TransformerError(f"Not a file: {comp}")
    node = _require_node()
    _ensure_css_worker_built()

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as fh:
        fh.write(style_body)
        body_file = Path(fh.name)
    try:
        proc = _run(
            [node, str(CSSMODULE_ENTRY), str(comp), module_specifier, str(body_file)],
            WORKER_DIR,
            _TIMEOUT,
        )
        if proc.returncode != 0:
            raise TransformerError(
                f"cssmodule-worker failed on {comp}:\n{proc.stderr.strip()}"
            )
        return proc.stdout
    finally:
        body_file.unlink(missing_ok=True)
