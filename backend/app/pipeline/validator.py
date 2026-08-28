"""Validator stage — the Migration Engine's judge.

The Validator proves the *deterministic* output is sound BEFORE any AI exists:
it runs REAL tools (never heuristics) against the emitted React Native project
and parses their output into structured, machine-readable diagnostics.

Everything here executes code derived from an uploaded project, so **no command
is spawned directly** — all of them go through ``app.pipeline.sandbox``, which
contains them (docker mode) and grants network access only to the one stage
that needs it.

  1. **Install** — ``npm install --ignore-scripts`` in the emitted project
     (cached across runs: skipped when ``node_modules`` already exists, unless
     ``force_install``). The only stage allowed to reach the network.
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

import hashlib
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Optional

# A progress sink for the async job layer: on_progress(stage, phase, payload).
# ``stage`` ∈ {"install","typecheck","bundle"}, ``phase`` ∈ {"started","completed"}.
# Optional and defaulted to None everywhere, so sync callers (CLI, tests) are
# entirely unaffected. The payload carries only observed facts.
ProgressFn = Callable[[str, str, dict[str, Any]], None]


def _emit(on_progress: Optional[ProgressFn], stage: str, phase: str, **payload: Any) -> None:
    if on_progress is not None:
        on_progress(stage, phase, payload)

from app.models.analysis import ConfidenceSource
from app.models.emission import EmittedFile, EmittedProject
from app.pipeline import sandbox
from app.pipeline.sandbox import SandboxPolicy
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


def _run(
    cmd: list[str],
    cwd: Path,
    timeout: int,
    *,
    network: bool = False,
    policy: Optional[SandboxPolicy] = None,
) -> subprocess.CompletedProcess[str]:
    """Every external command the Validator runs goes through the sandbox.

    ``network`` is opt-in per stage: only dependency installation needs it, so
    typecheck and bundle run with the network switched off in docker mode.
    """
    return sandbox.run(cmd, cwd, timeout, network=network, policy=policy)


def _tool(name: str, policy: SandboxPolicy) -> str:
    """Resolve a toolchain binary for the configured sandbox mode.

    In docker mode the command runs inside the image, so the bare name is what
    must be passed — a host absolute path would not exist in the container.
    """
    if policy.mode == "docker":
        return name
    found = shutil.which(name)
    if found is None:
        raise ValidatorError(f"`{name}` was not found on PATH; the Validator needs it.")
    return found


def _tail(text: str, n: int = 40) -> str:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return "\n".join(lines[-n:])


# --- Tool versions -----------------------------------------------------------


def _tool_versions(
    out_dir: Path, node: str, npm: str, policy: SandboxPolicy
) -> dict[str, str]:
    versions: dict[str, str] = {}
    try:
        versions["node"] = _run([node, "--version"], out_dir, 30, policy=policy).stdout.strip()
    except Exception:  # pragma: no cover - defensive
        pass
    try:
        versions["npm"] = _run([npm, "--version"], out_dir, 30, policy=policy).stdout.strip()
    except Exception:  # pragma: no cover
        pass
    tsc = _local_tsc(out_dir)
    if tsc:
        try:
            versions["typescript"] = _run(
                [node, tsc, "--version"], out_dir, 30, policy=policy
            ).stdout.strip().replace("Version ", "")
        except Exception:  # pragma: no cover
            pass
    return versions


# --- Install -----------------------------------------------------------------


def _install(
    out_dir: Path, npm: str, force: bool, policy: SandboxPolicy
) -> tuple[bool, Optional[str], bool]:
    """Return (installed, skipped_reason, ran_npm). Caches node_modules across
    runs, but invalidates the cache when ``package.json`` changes (e.g. a new
    dependency) so a stale ``node_modules`` never hides a newly-added package
    from Metro. ``ran_npm`` records whether ``npm install`` actually executed
    (vs a cache hit) — an observed fact, so the event stream never guesses.

    Runs with ``--ignore-scripts``: dependency lifecycle scripts (pre/post
    install) are arbitrary code from a tree the uploader influences, and Rejox
    only needs the package *files* to typecheck and bundle. This holds in both
    sandbox modes, so even the un-contained developer path does not execute a
    dependency's install hooks."""
    node_modules = out_dir / "node_modules"
    pkg = out_dir / "package.json"
    want = hashlib.sha256(pkg.read_bytes()).hexdigest() if pkg.is_file() else ""
    stamp = node_modules / ".rejox-deps-hash"
    fresh = stamp.is_file() and stamp.read_text().strip() == want
    if node_modules.is_dir() and fresh and not force:
        return True, None, False
    cmd = [npm, "install", "--no-audit", "--no-fund"]
    if not sandbox.npm_scripts_allowed():
        cmd.append("--ignore-scripts")
    proc = _run(cmd, out_dir, INSTALL_TIMEOUT_SECONDS, network=True, policy=policy)
    if proc.returncode != 0:
        return node_modules.is_dir(), f"npm install failed:\n{_tail(proc.stderr or proc.stdout)}", True
    if node_modules.is_dir():
        stamp.write_text(want)
    return node_modules.is_dir(), None, True


# --- Typecheck ---------------------------------------------------------------


def _local_tsc(out_dir: Path) -> Optional[str]:
    """Return the compiler path *relative to the project root*.

    Relative on purpose: the command is executed with the project root as its
    working directory, so the same string resolves both on the host (direct
    mode) and inside the container, where the root is mounted at ``/work``.
    """
    for rel in ("node_modules/typescript/bin/tsc", "node_modules/.bin/tsc"):
        if (out_dir / rel).exists():
            return rel
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


def _typecheck(out_dir: Path, node: str, policy: SandboxPolicy) -> StageResult:
    tsc = _local_tsc(out_dir)
    if tsc is None:
        return StageResult(
            ran=False, passed=False,
            skippedReason="local typescript compiler not found (was the project installed?)",
        )
    # No network: typechecking reads the installed tree and nothing else.
    proc = _run([node, tsc, "--noEmit"], out_dir, TYPECHECK_TIMEOUT_SECONDS, policy=policy)
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
    # In docker mode the toolchain reports container paths, where the project
    # root is mounted at /work — strip that prefix so diagnostics name the same
    # project-relative file in both modes.
    if path.startswith("/work/"):
        return path[len("/work/"):]
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


def _bundle(out_dir: Path, node: str, npm: str, policy: SandboxPolicy) -> StageResult:
    if policy.mode == "docker":
        npx = "npx"
    else:
        found = shutil.which("npx")
        if found is None:
            return StageResult(
                ran=False, passed=False, skippedReason="`npx` not found; cannot run Metro."
            )
        npx = found
    export_rel = ".rejox-bundle"
    export_dir = out_dir / export_rel
    if export_dir.exists():
        shutil.rmtree(export_dir, ignore_errors=True)
    # No network: Metro bundles the installed tree. `--output-dir` stays
    # relative so it resolves under /work inside the container too.
    proc = _run(
        [npx, "expo", "export", "--platform", "ios", "--output-dir", export_rel],
        out_dir,
        BUNDLE_TIMEOUT_SECONDS,
        policy=policy,
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
    on_progress: Optional[ProgressFn] = None,
    policy: Optional[SandboxPolicy] = None,
) -> ValidationResult:
    """Run the real toolchain against the emitted project and structure the result.

    Args:
        out_dir: the emitted React Native project root.
        install: run ``npm install`` (cached; skipped if ``node_modules`` exists).
        force_install: reinstall even when ``node_modules`` is present.
        run_bundle: run the Metro bundle (slowest stage; skippable for fast loops).
        run_lint: reserved; off by default.
        on_progress: optional sink fired at each real sub-stage boundary
            (install → typecheck → bundle), start and completion, with the
            counts observed there. Defaults to ``None`` (no-op) for sync callers.
        policy: how untrusted commands are executed. Defaults to the
            environment's :class:`SandboxPolicy`.
    """
    out_dir = Path(out_dir)
    if not (out_dir / "package.json").is_file():
        raise ValidatorError(f"No package.json in {out_dir}; nothing to validate.")

    policy = policy or SandboxPolicy.from_env()
    node = _tool("node", policy)
    npm = _tool("npm", policy)
    started = time.monotonic()

    # --- install ---
    _emit(on_progress, "install", "started")
    installed = (out_dir / "node_modules").is_dir()
    install_reason: Optional[str] = None
    ran_npm = False
    if install:
        installed, install_reason, ran_npm = _install(out_dir, npm, force_install, policy)
    # installSkipped reflects whether npm actually ran (observed), not just the flag.
    _emit(on_progress, "install", "completed", installed=installed, installSkipped=not ran_npm)

    if not installed:
        typecheck = StageResult(
            ran=False, passed=False,
            skippedReason=install_reason or "dependencies not installed",
        )
        bundle = StageResult(
            ran=False, passed=False,
            skippedReason=install_reason or "dependencies not installed",
        )
        for stage, res in (("typecheck", typecheck), ("bundle", bundle)):
            _emit(on_progress, stage, "started")
            _emit(on_progress, stage, "completed", ran=False, passed=False,
                  errorCount=0, diagnosticsFound=0, skippedReason=res.skippedReason)
        return ValidationResult(
            passed=False, installed=False, typecheck=typecheck, bundle=bundle,
            durationSeconds=round(time.monotonic() - started, 2),
            toolVersions=_tool_versions(out_dir, node, npm, policy),
        )

    # --- typecheck ---
    _emit(on_progress, "typecheck", "started")
    typecheck = _typecheck(out_dir, node, policy)
    _emit(on_progress, "typecheck", "completed", ran=typecheck.ran, passed=typecheck.passed,
          errorCount=typecheck.errorCount, diagnosticsFound=len(typecheck.diagnostics),
          skippedReason=typecheck.skippedReason)

    # --- bundle ---
    _emit(on_progress, "bundle", "started")
    if run_bundle:
        bundle = _bundle(out_dir, node, npm, policy)
    else:
        bundle = StageResult(ran=False, passed=False, skippedReason="run_bundle=False")
    _emit(on_progress, "bundle", "completed", ran=bundle.ran, passed=bundle.passed,
          errorCount=bundle.errorCount, diagnosticsFound=len(bundle.diagnostics),
          skippedReason=bundle.skippedReason)

    passed = typecheck.passed and (bundle.passed or not run_bundle)
    return ValidationResult(
        passed=passed,
        installed=True,
        typecheck=typecheck,
        bundle=bundle,
        durationSeconds=round(time.monotonic() - started, 2),
        toolVersions=_tool_versions(out_dir, node, npm, policy),
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
    # An empty population is NOT a perfect score. If nothing was emitted there
    # is nothing to be right about, so every ratio is None ("not measured")
    # rather than the 100% that a `x if total else 100.0` would invent — the
    # exact shape that let a migration emitting zero files report 100% coverage.
    confidence = (
        round(sum(confidence_values) / len(confidence_values), 1)
        if confidence_values
        else None
    )
    coverage = round(100.0 * migrated / total, 1) if total else None
    working_coverage = round(100.0 * working / total, 1) if total else None

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
