"""Repair loop — the last-resort LLM fixer.

The loop is exercised offline: a scripted validation (FAIL → PASS) plus a
FakeProvider that returns a corrected line, so we test the loop's *logic* — it
sends only the offending line, applies the fix, re-validates, caps at 2 rounds,
logs every attempt, and stamps AI-validated provenance — without the real
toolchain.
"""

from __future__ import annotations

from pathlib import Path

import app.pipeline.repair as repair_mod
from app.models.analysis import ConfidenceSource
from app.models.emission import EmittedFile, EmittedProject
from app.models.transformation import UnhandledItem
from app.models.validation import Diagnostic, StageResult, ValidationResult
from app.pipeline.repair import RepairAttempt, repair_project


def _validation(passed: bool, diagnostics=None) -> ValidationResult:
    diags = diagnostics or []
    return ValidationResult(
        passed=passed, installed=True,
        typecheck=StageResult(ran=True, passed=passed, diagnostics=diags, errorCount=len(diags)),
        bundle=StageResult(ran=True, passed=True),
    )


class ScriptedProvider:
    """Returns queued replacement lines; records what it was sent."""

    def __init__(self, replies: list[str]) -> None:
        self.replies = replies
        self.sent: list[str] = []

    def complete(self, system: str, user: str, *, max_tokens: int):
        from app.ai.provider import LLMResponse

        self.sent.append(user)
        text = self.replies[min(len(self.sent) - 1, len(self.replies) - 1)]
        return LLMResponse(text=text, model="fake", tokensIn=1, tokensOut=1)


def _emitted(out: Path) -> EmittedProject:
    # A file carrying a resolvable residue marker on the offending line.
    (out / "Broken.tsx").write_text(
        "export const x = (\n"
        "  // REJOX-TODO(NAV_LINK): wire navigation\n"
        "  <Pressable onPress={BROKEN}>x</Pressable>\n"
        ");\n"
    )
    return EmittedProject(
        outDir=str(out),
        files=[EmittedFile(
            path="Broken.tsx", sourceFile="src/Broken.tsx",
            provenance=ConfidenceSource.UNHANDLED,
            unhandled=[UnhandledItem(code="NAV_LINK", snippet="BROKEN")],
            todoCodes=["NAV_LINK"],
        )],
    )


def test_repair_fixes_a_resolvable_error_and_stamps_ai_validated(tmp_path, monkeypatch) -> None:
    emitted = _emitted(tmp_path)
    diag = Diagnostic(source="typecheck", file="Broken.tsx", line=3, code="TS2304",
                      message="Cannot find name 'BROKEN'.")

    # Scripted validation: initial FAIL (passed to repair), then PASS on re-run.
    calls = {"n": 0}

    def fake_validate(out_dir, *, install=True, run_bundle=True, **kw):
        calls["n"] += 1
        return _validation(passed=True)  # re-validation after the fix passes

    monkeypatch.setattr(repair_mod, "validate_project", fake_validate)
    provider = ScriptedProvider(["  <Pressable onPress={() => {}}>x</Pressable>"])

    result = repair_project(
        tmp_path, emitted, _validation(passed=False, diagnostics=[diag]),
        provider=provider, source_root=None, run_bundle=False,
    )

    assert result.passed is True
    assert result.rounds == 1
    assert len(result.attempts) == 1
    a: RepairAttempt = result.attempts[0]
    assert a.residueCode == "NAV_LINK"
    assert "BROKEN" in a.sent            # only the offending line was sent
    assert "onPress={() => {}}" in a.received
    # The fix landed in the file.
    assert "BROKEN" not in (tmp_path / "Broken.tsx").read_text()
    # Provenance upgraded to AI-validated (the LLM touched it and it now passes).
    assert emitted.files[0].provenance == ConfidenceSource.AI_VALIDATED


def test_repair_is_a_noop_when_validation_already_passed(tmp_path) -> None:
    emitted = _emitted(tmp_path)
    result = repair_project(tmp_path, emitted, _validation(passed=True), provider=object())
    assert result.rounds == 0 and result.passed is True
    assert "already passed" in result.stoppedReason


def test_repair_skips_when_ai_disabled(tmp_path) -> None:
    emitted = _emitted(tmp_path)
    diag = Diagnostic(source="typecheck", file="Broken.tsx", line=3, message="x")
    result = repair_project(tmp_path, emitted, _validation(False, [diag]), provider=None)
    assert result.rounds == 0 and result.passed is False
    assert "AI disabled" in result.stoppedReason


def test_repair_ignores_unexplained_errors(tmp_path, monkeypatch) -> None:
    # A clean deterministic file with NO residue marker → a codemod bug, not the
    # repair loop's job. It must NOT be sent to the LLM.
    (tmp_path / "Clean.tsx").write_text("export const y = OOPS;\n")
    emitted = EmittedProject(
        outDir=str(tmp_path),
        files=[EmittedFile(path="Clean.tsx", sourceFile="src/Clean.tsx",
                           provenance=ConfidenceSource.DETERMINISTIC)],
    )
    diag = Diagnostic(source="typecheck", file="Clean.tsx", line=1, code="TS2304",
                      message="Cannot find name 'OOPS'.")
    provider = ScriptedProvider(["export const y = 1;"])
    monkeypatch.setattr(repair_mod, "validate_project", lambda *a, **k: _validation(False))

    result = repair_project(tmp_path, emitted, _validation(False, [diag]), provider=provider)
    assert provider.sent == []  # never touched — unexplained errors aren't repaired
    assert "resolvable residue" in result.stoppedReason


def test_malformed_llm_output_is_rejected_not_written(tmp_path, monkeypatch) -> None:
    """The gate that was missing: a reply that does not parse must never land.

    A real run against a public repo wrote the offline provider's placeholder
    (`FAKE_RESPONSE[816f...]`) straight into two source files, because this was
    the one path in the pipeline that wrote a code artifact without the syntax
    check every other path performs. The provider is irrelevant — a real model
    returning prose or a truncated line does exactly the same damage.
    """
    emitted = _emitted(tmp_path)
    before = (tmp_path / "Broken.tsx").read_text()
    diag = Diagnostic(source="typecheck", file="Broken.tsx", line=3, code="TS2304",
                      message="Cannot find name 'BROKEN'.")
    monkeypatch.setattr(repair_mod, "validate_project", lambda *a, **k: _validation(False))
    provider = ScriptedProvider(["FAKE_RESPONSE[816f532cf5ff]"])

    result = repair_project(
        tmp_path, emitted, _validation(False, [diag]),
        provider=provider, run_bundle=False,
    )

    assert (tmp_path / "Broken.tsx").read_text() == before  # file untouched
    a: RepairAttempt = result.attempts[0]
    assert a.applied is False
    assert "syntax error" in a.rejectedReason
    assert "syntax gate" in result.stoppedReason


def test_markdown_fences_and_prose_are_stripped_before_the_gate(tmp_path, monkeypatch) -> None:
    """The prompt asks for a bare line; belt-and-braces strips the wrappers."""
    emitted = _emitted(tmp_path)
    diag = Diagnostic(source="typecheck", file="Broken.tsx", line=3, code="TS2304",
                      message="Cannot find name 'BROKEN'.")
    monkeypatch.setattr(repair_mod, "validate_project", lambda *a, **k: _validation(True))
    provider = ScriptedProvider(
        ["Here is the corrected line:\n```tsx\n  <Pressable onPress={() => {}}>x</Pressable>\n```"]
    )

    result = repair_project(
        tmp_path, emitted, _validation(False, [diag]),
        provider=provider, run_bundle=False,
    )

    a: RepairAttempt = result.attempts[0]
    assert a.received == "  <Pressable onPress={() => {}}>x</Pressable>"
    assert a.applied is True
    assert "BROKEN" not in (tmp_path / "Broken.tsx").read_text()
