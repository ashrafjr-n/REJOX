"""Apply the AI Resolution Engine to an emitted file (the emit → resolve step).

The Deterministic Transformer leaves residue markers; the resolvers decide how to
re-express them; this module *applies* those decisions to the file on disk, in
the tier order the engine defines (CSS Module → styling → NAV_ACTIVE), then
strips the REJOX-TODO markers for everything that was resolved. Genuinely
unresolvable residue (a runtime ``<Link to>``, an LLM ``unresolvable``) keeps its
TODO, and so does every resolution that removed something a human still has to
re-express — a gradient, a blur layer, a dropped CSS declaration. Those become
``TW_STRUCTURAL`` / ``CSS_STRUCTURAL`` TODOs that carry the RN code to write:
nothing is dropped silently.

The actual AST edits run in the codemod-worker (``cssmodule.js`` / ``apply.js``);
Python only orchestrates and reports which tier resolved what.
"""

from __future__ import annotations

import json
import re
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from rejox import workers
from rejox.ai.cache import ResolutionCache
from rejox.ai.css import resolve_css_module
from rejox.ai.css.parser import rewrite_component
from rejox.ai.provider import LLMProvider
from rejox.ai.styling import MappedResidue, resolve_styling
from rejox.models.transformation import UnhandledItem

_APPLY_TIMEOUT = 120

_CSS_IMPORT_RE = re.compile(r"""import\s+\w+\s+from\s+['"]([^'"]+\.module\.css)['"]""")
_TODO_HEADER_RE = re.compile(r"^//\s*=====\s*REJOX-TODO:\s*\d+\s*item")
_TODO_LINE_RE = re.compile(r"^//\s*REJOX-TODO\(([A-Z_]+)\)")
_INLINE_TODO_RE = re.compile(r"\{\s*/\*\s*REJOX-TODO\(([A-Z_]+)\)[\s\S]*?\*/\s*\}")


# Residue a resolution left for a human (see the module docstring).
TW_STRUCTURAL = "TW_STRUCTURAL"
CSS_STRUCTURAL = "CSS_STRUCTURAL"


@dataclass
class ApplyOutcome:
    resolvedCodes: set[str] = field(default_factory=set)
    remainingCodes: set[str] = field(default_factory=set)
    # The residue still in the file after resolution, each item narrowed to
    # what is actually left (a half-resolved TW_UNSUPPORTED keeps only the
    # classes no rule covered).
    remaining: list[UnhandledItem] = field(default_factory=list)
    tiers: Counter = field(default_factory=Counter)
    # What was resolved but still needs a human — also written into the file as
    # REJOX-TODO lines, and reported as residue by the emitter.
    review: list[UnhandledItem] = field(default_factory=list)


# --- codemod bridge ----------------------------------------------------------


def _run_apply(component_path: Path, plan: dict[str, Any]) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump(plan, fh)
        plan_file = Path(fh.name)
    try:
        proc = workers.run("codemod", ["apply", str(component_path), str(plan_file)], _APPLY_TIMEOUT)
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


def _review_message(snippet: str, code: str, kind: str, note: str, explanation: str) -> str:
    """One TODO message: what was removed, what RN needs instead, and — for a
    structural answer — the code to write, one comment line per source line."""
    what = f"`{snippet}` → `{code.strip()}`" if kind == "classname" else f"`{snippet}` removed from className"
    msg = f"{what} — {note or explanation}".rstrip()
    if kind == "structural":
        msg += "\n" + "\n".join(f"  {ln}" for ln in code.strip().splitlines())
    return msg


def build_class_map(
    residue_snippet: str,
    *,
    component: str,
    source_file: Optional[str],
    options: dict[str, Any],
    provider: Optional[LLMProvider],
    cache: ResolutionCache,
) -> tuple[dict[str, list[str]], Counter, list[UnhandledItem], list[str]]:
    """Resolve one file's TW_UNSUPPORTED bag into a token→replacement map.

    Returns (classMap, tierCounts, review, unresolved). A className resolution
    (hover→active, grid→flex-wrap) maps its tokens to the replacement; a
    structural one (gradient/backdrop/animate) or a drop (transition) removes its
    tokens. Whatever still needs a human — every structural answer, and every
    resolution marked ``needsReview`` — comes back in ``review`` as a
    TW_STRUCTURAL item. An ``unresolvable`` unit (no rule, and the LLM declined
    or AI is disabled) keeps its tokens: they come back in ``unresolved`` and
    stay residue."""
    from rejox.pipeline.transformer import check_syntax

    residue = MappedResidue(snippet=residue_snippet, componentName=component, sourceFile=source_file)
    resolutions = resolve_styling(
        [residue], options, provider=provider, cache=cache, syntax_check=check_syntax
    )
    class_map: dict[str, list[str]] = {}
    tiers: Counter = Counter()
    review: list[UnhandledItem] = []
    unresolved: list[str] = []
    for res in resolutions:
        tokens = res.snippet.split()
        if res.response.unresolvable:
            unresolved.extend(tokens)
            tiers["unresolved"] += 1  # counted, so no summary reads "all resolved"
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
        if kind == "structural" or res.needsReview:
            review.append(UnhandledItem(
                code=TW_STRUCTURAL,
                snippet=_review_message(
                    res.snippet, res.response.code, kind, res.note, res.response.explanation,
                ),
            ))
    return class_map, tiers, review, unresolved


# --- TODO stripping ----------------------------------------------------------


def _todo_lines(item: UnhandledItem) -> list[str]:
    first, *rest = item.snippet.splitlines() or [""]
    return [f"// REJOX-TODO({item.code}): {first}", *(f"// {ln}" for ln in rest)]


def strip_resolved_todos(
    text: str,
    resolved: set[str],
    replacements: Optional[dict[str, list[UnhandledItem]]] = None,
) -> str:
    """Remove REJOX-TODO markers (header lines + inline) for resolved codes and
    fix the ``===== REJOX-TODO: N`` count; unresolved codes keep their marker.

    ``replacements`` maps a code to the items that take its header line's place
    (a resolved TW_UNSUPPORTED line becomes the TW_STRUCTURAL lines that are
    still owed), so the header block stays the one list of what needs a human."""
    pending = {code: list(items) for code, items in (replacements or {}).items()}
    lines = text.splitlines()
    kept: list[str] = []
    for ln in lines:
        m = _TODO_LINE_RE.match(ln.strip())
        if m and m.group(1) in pending:
            for item in pending.pop(m.group(1)):
                kept.extend(_todo_lines(item))
        if m and m.group(1) in resolved:
            continue  # drop the whole header comment line
        ln = _INLINE_TODO_RE.sub(
            lambda mm: "" if mm.group(1) in resolved else mm.group(0), ln
        )
        kept.append(ln)
    if pending:
        # No header line to stand in for (the codemod always writes one, but a
        # TODO must never be lost to that assumption): open a banner at the top.
        owed = [line for items in pending.values() for item in items for line in _todo_lines(item)]
        kept = ["// ===== REJOX-TODO: 0 item(s) need attention =====", *owed, "", *kept]

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
    css_review: list[UnhandledItem] = []
    tw_review: list[UnhandledItem] = []

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
            # A declaration or selector the StyleSheet could not carry, and a
            # :hover variant that exists in the StyleSheet but is applied nowhere.
            css_review.extend(
                UnhandledItem(code=CSS_STRUCTURAL, snippet=f"{specifier}: {msg}")
                for msg in (*(w.message for w in res.warnings), *res.notes)
            )
        outcome.resolvedCodes.add("CSS_MODULE")

    # Tier: styling (TW_UNSUPPORTED) + NAV_ACTIVE via the apply codemod.
    class_map: dict[str, list[str]] = {}
    tw_unresolved: list[str] = []
    for u in unhandled:
        if u.code == "TW_UNSUPPORTED":
            cm, tiers, review, unresolved = build_class_map(
                u.snippet, component=component, source_file=source_file,
                options=options, provider=provider, cache=cache,
            )
            class_map.update(cm)
            outcome.tiers.update(tiers)
            tw_review.extend(review)
            tw_unresolved.extend(unresolved)
    tw_fully = not tw_unresolved

    nav_active = "NAV_ACTIVE" in codes
    if class_map or nav_active:
        plan = {"classMap": class_map, "navActive": nav_active}
        target_path.write_text(_run_apply(target_path, plan))
        if nav_active:
            outcome.resolvedCodes.add("NAV_ACTIVE")
            outcome.tiers["rule"] += 1
        if "TW_UNSUPPORTED" in codes and tw_fully:
            outcome.resolvedCodes.add("TW_UNSUPPORTED")

    # Strip the markers we resolved — each replaced by what it still owes — and
    # recompute what remains.
    tw_left: Optional[UnhandledItem] = None
    tw_line = list(tw_review)
    if "TW_UNSUPPORTED" in codes and not tw_fully:
        # Some classes were resolved: restate the marker with only the rest.
        tw_left = UnhandledItem(code="TW_UNSUPPORTED", snippet=" ".join(sorted(set(tw_unresolved))))
        tw_line.append(UnhandledItem(
            code="TW_UNSUPPORTED",
            snippet=(
                f"{len(set(tw_unresolved))} Tailwind class(es) have no NativeWind mapping "
                f"and no rule covers them: {', '.join(sorted(set(tw_unresolved)))} — re-express by hand."
            ),
        ))
    replacements = {
        code: items
        for code, items in (("CSS_MODULE", css_review), ("TW_UNSUPPORTED", tw_line))
        if items
    }
    # A replaced marker's original line goes, resolved or not: what replaces it
    # already says what is left.
    dropped = outcome.resolvedCodes | set(replacements)
    if dropped:
        target_path.write_text(strip_resolved_todos(target_path.read_text(), dropped, replacements))
    outcome.review = css_review + tw_review
    outcome.remainingCodes = codes - outcome.resolvedCodes
    outcome.remaining = [
        tw_left if (u.code == "TW_UNSUPPORTED" and tw_left is not None) else u
        for u in unhandled
        if u.code in outcome.remainingCodes
    ]
    return outcome
