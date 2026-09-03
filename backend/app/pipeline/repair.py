"""The repair loop — the last, honest resort.

After emit → validate, most errors are already gone (the resolvers ran in emit).
Anything left that maps to a *resolvable* residue code gets one targeted LLM
repair: we send ONLY the offending line + its diagnostic (never the whole file),
apply the returned line, and re-validate. At most two rounds, then we stop and
report honestly.

Provenance is truthful: a file the LLM touched that then validates is
``ai-validated`` (65); one that still fails is ``ai-failed`` (0). Every attempt
is logged — what error, what was sent, what came back, and whether it fixed it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

# Fired after each completed repair round: on_round(round, maxRounds, attempts, passed).
# Optional so sync callers (CLI, tests) are unaffected.
RoundFn = Callable[[int, int, int, bool], None]

from app.ai.provider import LLMProvider
from app.models.analysis import ConfidenceSource
from app.models.emission import EmittedProject
from app.models.validation import MappedDiagnostic, ValidationResult
from app.pipeline.validator import map_diagnostics, validate_project

MAX_REPAIR_ROUNDS = 2
_REPAIR_MAX_TOKENS = 400
_FENCE_RE = re.compile(r"^```[a-zA-Z0-9]*\n?|\n?```$", re.MULTILINE)
# A prose preamble the prompt already asks the model NOT to write ("Here is the
# corrected line:"). Recognised as a line ending in a colon that carries none of
# the punctuation real code would. A false positive is harmless: that line is
# skipped, the next candidate is tried, and no candidate at all means "no
# change", which leaves the file exactly as it was.
_PREAMBLE_RE = re.compile(r"^[^;{}<>()=\[\]]*[A-Za-z][^;{}<>()=\[\]]*:\s*$")

# Residue codes the repair loop is allowed to touch. An *unexplained* diagnostic
# (no residue) is a codemod bug — we do NOT paper over it with the LLM.
_RESOLVABLE_CODES = {
    "NAV_LINK", "NAV_ACTIVE", "NAV_HOOK", "CSS_MODULE", "TW_UNSUPPORTED",
    "EVENT_ADAPTER", "FORM_SUBMIT", "PROPS_HTML_TYPE",
}


@dataclass
class RepairAttempt:
    round: int
    file: str
    line: int
    diagnostic: str          # e.g. "TS2322 Type '…' is not assignable…"
    residueCode: str
    sent: str                # the exact line handed to the LLM
    received: str            # the LLM's replacement line
    fixed: bool = False      # did re-validation clear this file's errors?
    applied: bool = False    # was the line actually written to the file?
    rejectedReason: str = ""  # why it was not written (failed the syntax gate)


@dataclass
class RepairResult:
    rounds: int = 0
    attempts: list[RepairAttempt] = field(default_factory=list)
    passed: bool = False
    validation: Optional[ValidationResult] = None
    stoppedReason: str = ""


def _repairable(m: MappedDiagnostic) -> bool:
    return (
        m.diagnostic.severity == "error"
        and bool(m.diagnostic.file)
        and m.diagnostic.line is not None
        and bool(set(m.nearbyTodo) & _RESOLVABLE_CODES)
    )


def _build_prompt(m: MappedDiagnostic, line_text: str) -> tuple[str, str]:
    residue = next((c for c in m.nearbyTodo if c in _RESOLVABLE_CODES), "?")
    system = (
        "You repair ONE line of React Native code that failed type-check or "
        "bundling. Output ONLY the corrected line — valid TS/JSX, no prose, no "
        "markdown fences, no extra lines. If you cannot fix it, return the line "
        "unchanged."
    )
    user = (
        f"Error: {m.diagnostic.code or ''} {m.diagnostic.message}\n"
        f"Residue: {residue}\n"
        f"Line {m.diagnostic.line}:\n{line_text}"
    )
    return system, user


def _clean_response(text: str) -> str:
    """Reduce the model's reply to the single line of code it was asked for.

    The prompt asks for a bare line — no fences, no prose — but a prompt is a
    request, not a guarantee, so the obvious wrappers come off here before the
    syntax gate sees the result.
    """
    body = _FENCE_RE.sub("", text).strip()
    for line in body.splitlines():
        if not line.strip() or _PREAMBLE_RE.match(line):
            continue
        return line
    return ""


def _apply_line(path: Path, line_no: int, new_line: str) -> tuple[bool, str]:
    """Patch one line — but only if it does not make the file parse worse.

    Every other path that writes a code artifact in this pipeline is gated: the
    codemod-worker refuses to emit code it cannot prove parses, and the
    resolvers hand their output to ``check_syntax`` before it lands. Model
    output is the least trustworthy source in the system, so it goes through
    the same gate rather than a weaker one.

    The test is *relative* — new syntax errors, not zero errors — because the
    file being repaired may already be broken (that is usually why it is here),
    and a repair that leaves it no worse is still allowed to land.

    Returns ``(applied, rejected_reason)``.
    """
    from app.pipeline.transformer import TransformerError, check_syntax

    original = path.read_text()
    lines = original.splitlines()
    if not (1 <= line_no <= len(lines)):
        return False, f"line {line_no} is outside the file"
    lines[line_no - 1] = new_line
    candidate = "\n".join(lines) + "\n"
    try:
        before, after = check_syntax(original), check_syntax(candidate)
    except TransformerError as exc:
        # Cannot prove it is safe → do not write it.
        return False, f"syntax check unavailable ({exc})"
    if after > before:
        return False, (
            f"rejected: the replacement introduced {after - before} syntax "
            f"error(s); the file was left as it was"
        )
    path.write_text(candidate)
    return True, ""


def repair_project(
    out_dir: Path | str,
    emitted: EmittedProject,
    validation: ValidationResult,
    *,
    provider: Optional[LLMProvider],
    source_root: Optional[Path | str] = None,
    max_rounds: int = MAX_REPAIR_ROUNDS,
    run_bundle: bool = True,
    on_round: Optional[RoundFn] = None,
) -> RepairResult:
    """Run up to ``max_rounds`` targeted LLM repairs; re-validate after each.

    ``on_round`` (optional) is fired once per completed round with the real
    counts ``(round, maxRounds, attemptsThisRound, passed)`` so the job layer
    can emit a truthful per-round event.
    """
    out_dir = Path(out_dir)
    result = RepairResult(validation=validation, passed=validation.passed)
    if validation.passed:
        result.stoppedReason = "validation already passed — no repair needed"
        return result
    if provider is None:
        result.stoppedReason = "AI disabled (no provider) — cannot run LLM repair"
        return result

    repaired_files: set[str] = set()
    current = validation
    for rnd in range(1, max_rounds + 1):
        mapped = map_diagnostics(current, emitted, source_root=source_root)
        targets = [m for m in mapped if _repairable(m)]
        if not targets:
            result.stoppedReason = "no remaining errors map to a resolvable residue code"
            break

        # One repair per (file, line) per round.
        seen: set[tuple[str, int]] = set()
        touched = False
        for m in targets:
            key = (m.diagnostic.file, m.diagnostic.line)  # type: ignore[arg-type]
            if key in seen:
                continue
            seen.add(key)
            fp = out_dir / m.diagnostic.file  # type: ignore[operator]
            if not fp.is_file():
                continue
            lines = fp.read_text().splitlines()
            line_text = lines[m.diagnostic.line - 1] if m.diagnostic.line <= len(lines) else ""  # type: ignore[operator]
            system, user = _build_prompt(m, line_text)
            resp = provider.complete(system, user, max_tokens=_REPAIR_MAX_TOKENS)
            new_line_text = _clean_response(resp.text) or line_text
            attempt = RepairAttempt(
                round=rnd, file=m.diagnostic.file,  # type: ignore[arg-type]
                line=m.diagnostic.line,  # type: ignore[arg-type]
                diagnostic=f"{m.diagnostic.code or ''} {m.diagnostic.message}".strip(),
                residueCode=next((c for c in m.nearbyTodo if c in _RESOLVABLE_CODES), "?"),
                sent=line_text, received=new_line_text,
            )
            result.attempts.append(attempt)
            if new_line_text and new_line_text != line_text:
                applied, reason = _apply_line(fp, m.diagnostic.line, new_line_text)  # type: ignore[arg-type]
                attempt.applied = applied
                attempt.rejectedReason = reason
                if applied:
                    repaired_files.add(m.diagnostic.file)  # type: ignore[arg-type]
                    touched = True

        result.rounds = rnd
        current = validate_project(out_dir, install=False, run_bundle=run_bundle)
        result.validation = current
        result.passed = current.passed
        # Mark which attempts led to a clean file.
        clean_files = {
            m.file for m in map_diagnostics(current, emitted, source_root=source_root)
            if m.diagnostic.severity == "error"
        }
        for a in result.attempts:
            a.fixed = a.file not in clean_files
        if on_round is not None:
            attempts_this_round = sum(1 for a in result.attempts if a.round == rnd)
            on_round(rnd, max_rounds, attempts_this_round, current.passed)
        if current.passed:
            result.stoppedReason = "validation passed after repair"
            break
        if not touched:
            rejected = sum(1 for a in result.attempts if a.round == rnd and a.rejectedReason)
            result.stoppedReason = (
                f"every replacement this round was rejected by the syntax gate "
                f"({rejected}) — nothing safe to apply"
                if rejected
                else "LLM returned no change — nothing more to try"
            )
            break
    else:
        result.stoppedReason = f"reached max {max_rounds} repair round(s)"

    # Stamp provenance for every file the LLM touched.
    final_errors = {
        m.file for m in map_diagnostics(current, emitted, source_root=source_root)
        if m.diagnostic.severity == "error"
    }
    for f in emitted.files:
        if f.path in repaired_files:
            f.provenance = (
                ConfidenceSource.AI_FAILED if f.path in final_errors
                else ConfidenceSource.AI_VALIDATED
            )
    return result
