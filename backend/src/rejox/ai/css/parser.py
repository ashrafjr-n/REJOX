"""CSS Module resolver — Node bridge.

Parsing (postcss) and the component AST rewrite (ts-morph) both live in the
codemod-worker, orchestrated from Python exactly like the transformer. Python
never parses CSS or JSX itself; these two thin wrappers are the only seam.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from pydantic import ValidationError

from rejox import workers
from rejox.ai.css.models import ParsedCss
from rejox.pipeline.transformer import TransformerError

_TIMEOUT = 120


def parse_css_module(path: Path | str) -> ParsedCss:
    """Parse a ``.module.css`` file into a structured AST via postcss (Node)."""
    source = Path(path).expanduser().resolve()
    if not source.is_file():
        raise TransformerError(f"Not a file: {source}")
    proc = workers.run("codemod", ["css", str(source)], _TIMEOUT)
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
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as fh:
        fh.write(style_body)
        body_file = Path(fh.name)
    try:
        proc = workers.run(
            "codemod", ["cssmodule", str(comp), module_specifier, str(body_file)], _TIMEOUT
        )
        if proc.returncode != 0:
            raise TransformerError(
                f"cssmodule-worker failed on {comp}:\n{proc.stderr.strip()}"
            )
        return proc.stdout
    finally:
        body_file.unlink(missing_ok=True)
