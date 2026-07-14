"""Apply the AI Resolution Engine to an emitted file (the emit → resolve step).

The Deterministic Transformer leaves residue markers; the resolvers decide how to
re-express them; this module *applies* those decisions to the file on disk, in
the tier order the engine defines (CSS Module → styling → NAV_ACTIVE), then
strips the REJOX-TODO markers for everything that was resolved. Only genuinely
unresolvable residue (a runtime ``<Link to>``, an LLM ``unresolvable``) keeps its
TODO.

The actual AST edits run in the codemod-worker (``cssmodule.js`` / ``apply.js``);
Python only orchestrates and reports which tier resolved what.
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from app.ai.cache import ResolutionCache
from app.ai.css import resolve_css_module
from app.ai.css.parser import rewrite_component
from app.ai.navigation import resolve_nav_active
from app.ai.provider import LLMProvider
from app.ai.styling import MappedResidue, resolve_styling
from app.models.transformation import UnhandledItem
from app.pipeline.transformer import WORKER_DIR, _require_node, _run, ensure_worker_built

APPLY_ENTRY = WORKER_DIR / "dist" / "apply.js"
_APPLY_TIMEOUT = 120

_CSS_IMPORT_RE = re.compile(r"""import\s+\w+\s+from\s+['"]([^'"]+\.module\.css)['"]""")
_TODO_HEADER_RE = re.compile(r"^//\s*=====\s*REJOX-TODO:\s*\d+\s*item")
_TODO_LINE_RE = re.compile(r"^//\s*REJOX-TODO\(([A-Z_]+)\)")
_INLINE_TODO_RE = re.compile(r"\{\s*/\*\s*REJOX-TODO\(([A-Z_]+)\)[\s\S]*?\*/\s*\}")


@dataclass
class ApplyOutcome:
    resolvedCodes: set[str] = field(default_factory=set)
    remainingCodes: set[str] = field(default_factory=set)
    tiers: Counter = field(default_factory=Counter)
    notes: list[str] = field(default_factory=list)


# --- codemod bridge ----------------------------------------------------------


def _run_apply(component_path: Path, plan: dict[str, Any]) -> str:
    node = _require_node()
    ensure_worker_built()
    if not APPLY_ENTRY.exists():
        ensure_worker_built(force=True)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump(plan, fh)
        plan_file = Path(fh.name)
    try:
        proc = _run([node, str(APPLY_ENTRY), str(component_path), str(plan_file)], WORKER_DIR, _APPLY_TIMEOUT)
        if proc.returncode != 0:
            raise RuntimeError(f"apply-worker failed on {component_path}:\n{proc.stderr.strip()}")
        return proc.stdout
    finally:
        plan_file.unlink(missing_ok=True)


# --- styling → classMap ------------------------------------------------------


def _code_kind(code: str) -> str:
    c = code.strip()
    if not c:
        return "drop"
    if "<" in c or "{" in c or "\n" in c:
        return "structural"
    return "classname"


def build_class_map(
    residue_snippet: str,
    *,
    component: str,
    source_file: Optional[str],
    options: dict[str, Any],
    provider: Optional[LLMProvider],
    cache: ResolutionCache,
) -> tuple[dict[str, list[str]], Counter, list[str], bool]:
    """Resolve one file's TW_UNSUPPORTED bag into a token→replacement map.

    Returns (classMap, tierCounts, notes, fullyResolved). A className resolution
    (hover→active, grid→flex-wrap) maps its tokens to the replacement; a
    structural one (gradient/backdrop/animate) or a drop (transition) removes its
    tokens and records the manual RN note. An LLM ``unresolvable`` keeps the
    tokens (they stay residue)."""
    from app.pipeline.transformer import check_syntax

    residue = MappedResidue(snippet=residue_snippet, componentName=component, sourceFile=source_file)
    resolutions = resolve_styling(
        [residue], options, provider=provider, cache=cache, syntax_check=check_syntax
    )
    class_map: dict[str, list[str]] = {}
    tiers: Counter = Counter()
    notes: list[str] = []
    fully_resolved = True
    for res in resolutions:
        tokens = res.snippet.split()
        if res.response.unresolvable:
            fully_resolved = False
            continue
        tiers[res.tier.value] += 1
        kind = _code_kind(res.response.code)
        if kind == "classname":
            class_map[tokens[0]] = res.response.code.split()
            for t in tokens[1:]:
                class_map[t] = []
        else:  # drop or structural
            for t in tokens:
                class_map[t] = []
            if kind == "structural" and res.note:
                notes.append(f"{res.snippet} → {res.note}")
    return class_map, tiers, notes, fully_resolved


# --- TODO stripping ----------------------------------------------------------


def strip_resolved_todos(text: str, resolved: set[str]) -> str:
    """Remove REJOX-TODO markers (header lines + inline) for resolved codes and
    fix the ``===== REJOX-TODO: N`` count; unresolved codes keep their marker."""
    lines = text.splitlines()
    kept: list[str] = []
    for ln in lines:
        m = _TODO_LINE_RE.match(ln.strip())
        if m and m.group(1) in resolved:
            continue  # drop the whole header comment line
        ln = _INLINE_TODO_RE.sub(
            lambda mm: "" if mm.group(1) in resolved else mm.group(0), ln
        )
        kept.append(ln)

    remaining = sum(1 for ln in kept if _TODO_LINE_RE.match(ln.strip()))
    out: list[str] = []
    for ln in kept:
        if _TODO_HEADER_RE.match(ln.strip()):
            if remaining == 0:
                continue  # nothing left to flag → drop the banner
            ln = re.sub(r"(REJOX-TODO:\s*)\d+", rf"\g<1>{remaining}", ln)
        out.append(ln)
    result = "\n".join(out)
    return result + "\n" if text.endswith("\n") else result


# --- orchestration -----------------------------------------------------------


def apply_resolutions(
    target_path: Path,
    src_abs: Path,
    *,
    unhandled: list[UnhandledItem],
    component: str,
    source_file: Optional[str],
    options: dict[str, Any],
    provider: Optional[LLMProvider],
    cache: ResolutionCache,
) -> ApplyOutcome:
    """Resolve + apply every resolvable residue in ``target_path`` (in place)."""
    codes = {u.code for u in unhandled}
    outcome = ApplyOutcome(remainingCodes=set(codes))

    # Tier: CSS Module → inline StyleSheet, drop the .css import (never copied).
    if "CSS_MODULE" in codes:
        text = target_path.read_text()
        for specifier in dict.fromkeys(_CSS_IMPORT_RE.findall(text)):
            css_path = (src_abs.parent / specifier).resolve()
            if not css_path.is_file():
                continue
            res = resolve_css_module(css_path, module=specifier, provider=provider, cache=cache)
            rewritten = rewrite_component(target_path, specifier, res.styleSheetBody)
            target_path.write_text(rewritten)
            outcome.tiers.update(res.tiers)
            outcome.notes.extend(res.notes)
        outcome.resolvedCodes.add("CSS_MODULE")

    # Tier: styling (TW_UNSUPPORTED) + NAV_ACTIVE via the apply codemod.
    class_map: dict[str, list[str]] = {}
    tw_fully = True
    for u in unhandled:
        if u.code == "TW_UNSUPPORTED":
            cm, tiers, notes, tw_fully = build_class_map(
                u.snippet, component=component, source_file=source_file,
                options=options, provider=provider, cache=cache,
            )
            class_map.update(cm)
            outcome.tiers.update(tiers)
            outcome.notes.extend(notes)

    nav_active = "NAV_ACTIVE" in codes
    if class_map or nav_active:
        plan = {"classMap": class_map, "navActive": nav_active}
        target_path.write_text(_run_apply(target_path, plan))
        if nav_active:
            outcome.resolvedCodes.add("NAV_ACTIVE")
            outcome.tiers["rule"] += 1
        if "TW_UNSUPPORTED" in codes and tw_fully:
            outcome.resolvedCodes.add("TW_UNSUPPORTED")

    # Strip the markers we resolved; recompute what remains.
    if outcome.resolvedCodes:
        target_path.write_text(strip_resolved_todos(target_path.read_text(), outcome.resolvedCodes))
    outcome.remainingCodes = codes - outcome.resolvedCodes
    return outcome
