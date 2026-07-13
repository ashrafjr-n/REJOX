"""Validator stage — the Migration Engine's judge.

The Validator proves the *deterministic* output is sound BEFORE any AI exists:
it runs REAL tools (never heuristics) against the emitted React Native project
and parses their output into structured, machine-readable diagnostics.

  1. **Install** — ``npm install`` in the emitted project (cached across runs:
     skipped when ``node_modules`` already exists, unless ``force_install``).
  2. **Typecheck** — the project's own ``tsc --noEmit`` (invoked via the local
     ``typescript`` binary, never ``npx tsc`` — ``npx`` will try to fetch an
     unrelated ``tsc`` package if it can't find the local one). Output is parsed
     into ``{file, line, column, code, message, severity}``.
  3. **Bundle** — the Metro bundler headlessly via ``expo export``. Metro fails
     fast (first unresolved module), so ``bundle`` typically carries one
     diagnostic; it is parsed the same structured way.
  4. **Lint** *(optional, off by default)* — reserved; kept cheap.

Failures loop back to the AI Resolution Engine as :class:`MappedDiagnostic`
(see ``map_diagnostics``); success gates Download. No LLM.

    validate_project(out_dir, *, install=True, force_install=False,
                     run_bundle=True, run_lint=False) -> ValidationResult
"""

from __future__ import annotations

import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Optional

from app.models.analysis import ConfidenceSource
from app.models.emission import EmittedFile, EmittedProject
from app.models.validation import (
    Diagnostic,
    MappedDiagnostic,
    StageResult,
    ValidatedScores,
    ValidationResult,
)

INSTALL_TIMEOUT_SECONDS = 900
TYPECHECK_TIMEOUT_SECONDS = 300
BUNDLE_TIMEOUT_SECONDS = 600

# `file(line,col): error TSxxxx: message` — the canonical tsc diagnostic line.
_TSC_RE = re.compile(
    r"^(?P<file>[^()\n]+?)\((?P<line>\d+),(?P<col>\d+)\):\s+"
    r"(?P<sev>error|warning)\s+(?P<code>TS\d+):\s+(?P<msg>.*)$"
)
# Metro's fail-fast resolution error.
_METRO_RESOLVE_RE = re.compile(
    r"Unable to resolve module\s+(?P<mod>\S+?)\s+from\s+(?P<file>[^:]+):"
)
# Babel/Metro transform errors: `SyntaxError: <file>: [BABEL] <abs>: <msg>`.
# The file token must be whitespace-free so this never re-captures a
# "Unable to resolve module … from <file>" line (handled above).
_METRO_BABEL_RE = re.compile(
    r"(?:SyntaxError|Error):\s+(?P<file>[^:\n\s]+\.[jt]sx?):\s+(?P<msg>.*)"
)


class ValidatorError(RuntimeError):
    """Raised when the Validator cannot run its tools at all (missing node…)."""


def _run(cmd: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout)


def _which(name: str) -> str:
    found = shutil.which(name)
    if found is None:
        raise ValidatorError(f"`{name}` was not found on PATH; the Validator needs it.")
    return found


def _tail(text: str, n: int = 40) -> str:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return "\n".join(lines[-n:])


# --- Tool versions -----------------------------------------------------------


def _tool_versions(out_dir: Path, node: str, npm: str) -> dict[str, str]:
    versions: dict[str, str] = {}
    try:
        versions["node"] = _run([node, "--version"], out_dir, 30).stdout.strip()
    except Exception:  # pragma: no cover - defensive
        pass
    try:
        versions["npm"] = _run([npm, "--version"], out_dir, 30).stdout.strip()
    except Exception:  # pragma: no cover
        pass
    tsc = _local_tsc(out_dir)
    if tsc:
        try:
            versions["typescript"] = _run(
                [node, str(tsc), "--version"], out_dir, 30
            ).stdout.strip().replace("Version ", "")
        except Exception:  # pragma: no cover
            pass
    return versions


# --- Install -----------------------------------------------------------------


def _install(out_dir: Path, npm: str, force: bool) -> tuple[bool, Optional[str]]:
    """Return (installed, skipped_reason). Caches node_modules across runs."""
    node_modules = out_dir / "node_modules"
    if node_modules.is_dir() and not force:
        return True, None
    proc = _run([npm, "install", "--no-audit", "--no-fund"], out_dir, INSTALL_TIMEOUT_SECONDS)
    if proc.returncode != 0:
        return node_modules.is_dir(), f"npm install failed:\n{_tail(proc.stderr or proc.stdout)}"
    return node_modules.is_dir(), None


# --- Typecheck ---------------------------------------------------------------


def _local_tsc(out_dir: Path) -> Optional[Path]:
    for rel in ("node_modules/typescript/bin/tsc", "node_modules/.bin/tsc"):
        p = out_dir / rel
        if p.exists():
            return p
    return None


def _parse_tsc(output: str) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    for line in output.splitlines():
        m = _TSC_RE.match(line.strip())
        if not m:
            continue
        diagnostics.append(
            Diagnostic(
                source="typecheck",
                file=m.group("file").strip(),
                line=int(m.group("line")),
                column=int(m.group("col")),
                code=m.group("code"),
                severity=m.group("sev"),  # type: ignore[arg-type]
                message=m.group("msg").strip(),
            )
        )
    return diagnostics


def _typecheck(out_dir: Path, node: str) -> StageResult:
    tsc = _local_tsc(out_dir)
    if tsc is None:
        return StageResult(
            ran=False, passed=False,
            skippedReason="local typescript compiler not found (was the project installed?)",
        )
    proc = _run([node, str(tsc), "--noEmit"], out_dir, TYPECHECK_TIMEOUT_SECONDS)
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    diagnostics = _parse_tsc(combined)
    errors = [d for d in diagnostics if d.severity == "error"]
    return StageResult(
        ran=True,
        passed=proc.returncode == 0 and not errors,
        diagnostics=diagnostics,
        errorCount=len(errors),
        rawTail=_tail(combined),
    )


# --- Bundle (Metro via expo export) ------------------------------------------


def _relativize(path: str, out_dir: Path) -> str:
    try:
        return str(Path(path).resolve().relative_to(out_dir.resolve()))
    except (ValueError, OSError):
        return path


def _parse_metro(output: str, out_dir: Path) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    seen: set[str] = set()
    for m in _METRO_RESOLVE_RE.finditer(output):
        file = _relativize(m.group("file").strip(), out_dir)
        key = f"resolve:{file}:{m.group('mod')}"
        if key in seen:
            continue
        seen.add(key)
        diagnostics.append(
            Diagnostic(
                source="bundle",
                file=file,
                code="BUNDLE_UNRESOLVED",
                severity="error",
                message=f"Unable to resolve module {m.group('mod')} from {file}.",
            )
        )
    for m in _METRO_BABEL_RE.finditer(output):
        raw = m.group("file").strip()
        # Skip the generic "index.ts" babel wrapper lines when a real file exists.
        file = _relativize(raw, out_dir)
        key = f"babel:{file}:{m.group('msg')[:40]}"
        if key in seen:
            continue
        seen.add(key)
        diagnostics.append(
            Diagnostic(
                source="bundle",
                file=file if "/" in file or file.endswith((".ts", ".tsx", ".js")) else None,
                code="BUNDLE_TRANSFORM",
                severity="error",
                message=m.group("msg").strip(),
            )
        )
    return diagnostics


def _bundle(out_dir: Path, node: str, npm: str) -> StageResult:
    npx = shutil.which("npx")
    if npx is None:
        return StageResult(ran=False, passed=False, skippedReason="`npx` not found; cannot run Metro.")
    export_dir = out_dir / ".rejox-bundle"
    if export_dir.exists():
        shutil.rmtree(export_dir, ignore_errors=True)
    proc = _run(
        [npx, "expo", "export", "--platform", "ios", "--output-dir", str(export_dir)],
        out_dir,
        BUNDLE_TIMEOUT_SECONDS,
    )
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    diagnostics = _parse_metro(combined, out_dir)
    passed = proc.returncode == 0
    if not passed and not diagnostics:
        # Metro failed but we could not structure the error — surface the tail so
        # nothing is hidden.
        diagnostics.append(
            Diagnostic(source="bundle", severity="error", message=_tail(combined, 8))
        )
    shutil.rmtree(export_dir, ignore_errors=True)
    return StageResult(
        ran=True,
        passed=passed,
        diagnostics=diagnostics,
        errorCount=sum(1 for d in diagnostics if d.severity == "error"),
        rawTail=_tail(combined),
    )


# --- Entry point -------------------------------------------------------------


def validate_project(
    out_dir: Path | str,
    *,
    install: bool = True,
    force_install: bool = False,
    run_bundle: bool = True,
    run_lint: bool = False,
) -> ValidationResult:
    """Run the real toolchain against the emitted project and structure the result.

    Args:
        out_dir: the emitted React Native project root.
        install: run ``npm install`` (cached; skipped if ``node_modules`` exists).
        force_install: reinstall even when ``node_modules`` is present.
        run_bundle: run the Metro bundle (slowest stage; skippable for fast loops).
        run_lint: reserved; off by default.
    """
    out_dir = Path(out_dir)
    if not (out_dir / "package.json").is_file():
        raise ValidatorError(f"No package.json in {out_dir}; nothing to validate.")

    node = _which("node")
    npm = _which("npm")
    started = time.monotonic()

    installed = (out_dir / "node_modules").is_dir()
    install_reason: Optional[str] = None
    if install:
        installed, install_reason = _install(out_dir, npm, force_install)

    if not installed:
        typecheck = StageResult(
            ran=False, passed=False,
            skippedReason=install_reason or "dependencies not installed",
        )
        bundle = StageResult(
            ran=False, passed=False,
            skippedReason=install_reason or "dependencies not installed",
        )
        return ValidationResult(
            passed=False, installed=False, typecheck=typecheck, bundle=bundle,
            durationSeconds=round(time.monotonic() - started, 2),
            toolVersions=_tool_versions(out_dir, node, npm),
        )

    typecheck = _typecheck(out_dir, node)
    if run_bundle:
        bundle = _bundle(out_dir, node, npm)
    else:
        bundle = StageResult(ran=False, passed=False, skippedReason="run_bundle=False")

    passed = typecheck.passed and (bundle.passed or not run_bundle)
    return ValidationResult(
        passed=passed,
        installed=True,
        typecheck=typecheck,
        bundle=bundle,
        durationSeconds=round(time.monotonic() - started, 2),
        toolVersions=_tool_versions(out_dir, node, npm),
    )


# --- Diagnostic → source mapping (the AI Resolution Engine's contract) --------

# How many lines above/below the offending line to scan for REJOX-TODO markers.
_TODO_WINDOW = 8
_TODO_LINE_RE = re.compile(r"REJOX-TODO\(([A-Z_]+)\)")
# Quoted identifiers/paths in a tsc message ("Cannot find name 'Outlet'").
_QUOTED_RE = re.compile(r"['\"]([^'\"]+)['\"]")


def _context(lines: list[str], line: Optional[int], radius: int = 2) -> Optional[str]:
    if not line or line < 1 or line > len(lines):
        return None
    lo = max(0, line - 1 - radius)
    hi = min(len(lines), line + radius)
    out = []
    for i in range(lo, hi):
        marker = "→" if i == line - 1 else " "
        out.append(f"{marker} {i + 1:>4} | {lines[i]}")
    return "\n".join(out)


def _nearby_todos(lines: list[str], line: Optional[int]) -> list[str]:
    if not line:
        return []
    lo = max(0, line - 1 - _TODO_WINDOW)
    hi = min(len(lines), line + _TODO_WINDOW)
    codes: list[str] = []
    for i in range(lo, hi):
        codes.extend(_TODO_LINE_RE.findall(lines[i]))
    # Preserve order, de-dup.
    return list(dict.fromkeys(codes))


def _original_snippet(
    message: str, source_text: str
) -> Optional[str]:
    """Best-effort: locate the offending token in the React source and show it."""
    src_lines = source_text.splitlines()
    for key in _QUOTED_RE.findall(message):
        for idx, ln in enumerate(src_lines, start=1):
            if key in ln:
                return _context(src_lines, idx, radius=2)
    return None


def map_diagnostics(
    result: ValidationResult,
    emitted: EmittedProject,
    *,
    source_root: Optional[Path | str] = None,
) -> list[MappedDiagnostic]:
    """Tie every diagnostic back to the transform that produced it.

    This is the exact payload the AI Resolution Engine will consume as its
    repair loop: each error carries its output file, originating source file,
    provenance, the REJOX-TODO code(s) on/near the line, and the offending
    snippet (plus the corresponding React source when resolvable).

    A diagnostic whose file has ``unhandled`` residue — or a REJOX-TODO on/near
    the line — is legitimate residue (the AI Engine's job). A diagnostic in a
    clean ``deterministic`` file is an unexplained error: a codemod bug.
    """
    out_dir = Path(emitted.outDir)
    src_root = Path(source_root) if source_root else None
    by_path: dict[str, EmittedFile] = {f.path: f for f in emitted.files}

    # Cache emitted + source file texts.
    emitted_text: dict[str, list[str]] = {}
    source_text: dict[str, str] = {}

    def emitted_lines(path: str) -> list[str]:
        if path not in emitted_text:
            fp = out_dir / path
            emitted_text[path] = fp.read_text().splitlines() if fp.is_file() else []
        return emitted_text[path]

    def src_text(rel: Optional[str]) -> Optional[str]:
        if not rel or src_root is None:
            return None
        if rel not in source_text:
            fp = src_root / rel
            source_text[rel] = fp.read_text() if fp.is_file() else ""
        return source_text[rel] or None

    mapped: list[MappedDiagnostic] = []
    diagnostics = list(result.typecheck.diagnostics) + list(result.bundle.diagnostics)
    for diag in diagnostics:
        ef = by_path.get(diag.file) if diag.file else None
        lines = emitted_lines(diag.file) if diag.file else []

        # Line-proximate REJOX-TODO markers first (most specific), then the
        # file's full residue set (the TODO header sits above the window, so a
        # residue file always contributes its codes) — union, marker-order first.
        inline = _nearby_todos(lines, diag.line)
        file_codes = list(ef.todoCodes) if ef else []
        nearby = list(dict.fromkeys([*inline, *file_codes]))

        # Attribute to a specific residue item: prefer one whose token appears in
        # the message (e.g. isActive → NAV_ACTIVE), else the first matching code.
        residue = None
        if ef and ef.unhandled:
            keys = _QUOTED_RE.findall(diag.message)
            residue = next(
                (u for u in ef.unhandled if any(k in u.snippet for k in keys)), None
            ) or next((u for u in ef.unhandled if u.code in nearby), None)

        original = None
        st = src_text(ef.sourceFile if ef else None)
        if st:
            original = _original_snippet(diag.message, st)

        mapped.append(
            MappedDiagnostic(
                diagnostic=diag,
                file=diag.file,
                sourceComponent=ef.sourceFile if ef else None,
                provenance=ef.provenance if ef else None,
                nearbyTodo=nearby,
                sourceSnippet=_context(lines, diag.line) if lines else None,
                originalSnippet=original,
                residue=residue,
            )
        )
    return mapped


def unexplained_diagnostics(mapped: list[MappedDiagnostic]) -> list[MappedDiagnostic]:
    """Diagnostics that trace to NO residue — i.e. deterministic codemod bugs.

    A diagnostic is explained when its file carries residue (``unhandled`` /
    REJOX-TODO) that accounts for it. The gate the Validator enforces on the
    benchmark is that this list is EMPTY: every remaining error is honest
    residue the AI Resolution Engine will own.
    """
    out: list[MappedDiagnostic] = []
    for m in mapped:
        if m.diagnostic.severity != "error":
            continue
        explained = bool(m.nearbyTodo) or m.provenance == ConfidenceSource.UNHANDLED
        if not explained:
            out.append(m)
    return out


# --- Confidence wired to validated reality -----------------------------------

# Provenance → the Confidence value it earns once the validator has passed on it.
_VALIDATED_CONFIDENCE = {
    ConfidenceSource.DETERMINISTIC: 100,
    ConfidenceSource.DETERMINISTIC_WARNING: 80,
}


def validated_scores(
    emitted: EmittedProject,
    result: ValidationResult,
    *,
    predicted_coverage: Optional[float] = None,
    predicted_confidence: Optional[float] = None,
) -> ValidatedScores:
    """Recompute Coverage/Confidence from the emitted + VALIDATED project.

    Units are the ported/generated code files (``.ts``/``.tsx`` with a source).
    A unit with unresolved residue (``unhandled``/REJOX-TODO) is EXCLUDED from
    Confidence and counts against Coverage. A residue-free unit earns 100
    (deterministic) or 80 (deterministic-warning) — unless the validator
    actually failed on it, which would make it a codemod bug worth 0.
    """
    error_files = {
        d.file
        for d in (*result.typecheck.diagnostics, *result.bundle.diagnostics)
        if d.severity == "error" and d.file
    }

    units = [
        f
        for f in emitted.files
        if f.sourceFile and f.path.endswith((".ts", ".tsx"))
    ]

    confidence_values: list[int] = []
    migrated = 0
    residue = 0
    clean_det = 0
    clean_warn = 0
    failed: list[str] = []

    for f in units:
        has_residue = (
            f.provenance == ConfidenceSource.UNHANDLED
            or bool(f.unhandled)
            or bool(f.todoCodes)
        )
        if has_residue:
            residue += 1
            continue  # excluded from Confidence; counts against Coverage
        migrated += 1
        if f.path in error_files:
            # A residue-free file the validator still rejected: a real bug.
            confidence_values.append(0)
            failed.append(f.path)
            continue
        value = _VALIDATED_CONFIDENCE.get(f.provenance, 80)
        confidence_values.append(value)
        if value == 100:
            clean_det += 1
        else:
            clean_warn += 1

    total = len(units)
    working = sum(1 for f in units if f.path not in error_files)
    confidence = round(sum(confidence_values) / len(confidence_values), 1) if confidence_values else 100.0
    coverage = round(100.0 * migrated / total, 1) if total else 100.0
    working_coverage = round(100.0 * working / total, 1) if total else 100.0

    return ValidatedScores(
        coverage=coverage,
        confidence=confidence,
        workingCoverage=working_coverage,
        workingFileCount=working,
        migratedFileCount=migrated,
        residueFileCount=residue,
        totalUnitCount=total,
        validatorPassed=result.typecheck.passed,
        cleanDeterministic=clean_det,
        cleanWithWarning=clean_warn,
        failedUnits=failed,
        predictedCoverage=predicted_coverage,
        predictedConfidence=predicted_confidence,
    )
