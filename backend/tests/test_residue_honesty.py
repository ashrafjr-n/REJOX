"""Residue is never lost and never miscounted — with AI or without it.

Three regressions this file pins, each found by migrating a project that holds a
Tailwind class no rule covers (the benchmark app has none, so its green runs
never exercised these paths):

- **Zero AI must not crash.** With no ``GEMINI_API_KEY`` the styling resolver
  used to build a Gemini provider on its own and die on the missing key, taking
  the whole migration down (exit 70). The class must stay residue instead.
- **Every LLM call is counted.** Emit-time styling calls went to a provider the
  CLI never saw, so "Actual LLM calls" under-reported.
- **Nothing is dropped silently.** A gradient, a blur, a spinner — each removed
  from the className — used to leave no trace in the file. Each must leave a
  ``TW_STRUCTURAL`` TODO carrying the React Native code to write.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from rejox.ai.provider import FakeProvider
from rejox.ai.styling import MappedResidue, resolve_styling
from rejox.cli import app
from rejox.models.transformation import UnhandledItem
from rejox.pipeline.resolve_apply import strip_resolved_todos

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE = REPO_ROOT / "test-projects" / "sample-app"

runner = CliRunner()

# A router-less Tailwind app: `group` and an arbitrary animation no rule
# covers (only the LLM tier could answer them), and a gradient a rule resolves
# but a human still has to finish. Also migrated by scripts/wheel-smoke.sh.
RESIDUE_APP = Path(__file__).resolve().parent / "fixtures" / "residue-app"


@pytest.fixture
def no_ai(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)


def test_a_class_no_rule_covers_stays_residue_when_ai_is_disabled(no_ai) -> None:
    [res] = resolve_styling([MappedResidue(snippet="group")], provider=None)
    assert res.response.unresolvable
    assert "AI is disabled" in (res.response.reason or "")


def test_migrate_without_a_key_survives_unmapped_classes(tmp_path, no_ai) -> None:
    src = RESIDUE_APP
    out = tmp_path / "rn"

    result = runner.invoke(app, ["migrate", str(src), "--yes", "--no-validate", "--out", str(out)])

    assert result.exit_code == 0, result.output
    assert "Internal error" not in result.output
    assert "Actual LLM calls: 0" in result.output
    app_tsx = (out / "src" / "App.tsx").read_text()
    # The classes nothing could answer are kept, and named — only them.
    assert "group" in app_tsx and "animate-[wiggle_1s]" in app_tsx
    todo = next(ln for ln in app_tsx.splitlines() if "REJOX-TODO(TW_UNSUPPORTED)" in ln)
    assert "animate-[wiggle_1s], group" in todo
    assert "bg-gradient" not in todo


def test_a_removed_gradient_leaves_a_todo_with_the_rn_code(tmp_path, no_ai) -> None:
    src = RESIDUE_APP
    out = tmp_path / "rn"

    result = runner.invoke(app, ["migrate", str(src), "--yes", "--no-validate", "--out", str(out)])
    assert result.exit_code == 0, result.output

    app_tsx = (out / "src" / "App.tsx").read_text()
    assert "bg-gradient-to-r" not in app_tsx.split("export default", 1)[1]  # gone from the JSX…
    assert "REJOX-TODO(TW_STRUCTURAL): `bg-gradient-to-r from-indigo-600 to-violet-600`" in app_tsx
    assert "// " + "  <LinearGradient colors={['#4f46e5', '#7c3aed']}" in app_tsx  # …but not lost


def test_the_benchmark_flags_everything_it_removes(tmp_path, no_ai) -> None:
    """The three structural classes in sample-app, each with its TODO."""
    out = tmp_path / "rn"
    result = runner.invoke(app, ["migrate", str(SAMPLE), "--yes", "--no-validate", "--out", str(out)])
    assert result.exit_code == 0, result.output

    components = out / "src" / "components"
    for name, cls in (("Hero", "bg-gradient-to-br"), ("Spinner", "animate-spin"), ("Navbar", "backdrop-blur")):
        text = (components / f"{name}.tsx").read_text()
        assert f"REJOX-TODO(TW_STRUCTURAL): `{cls}" in text, name


def test_emit_time_llm_calls_are_counted(tmp_path, monkeypatch) -> None:
    """Every call the offline provider answers shows up in the summary."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("REJOX_AI_PROVIDER", "fake")
    calls: list[int] = []
    original = FakeProvider.complete

    def spy(self, system, user, *, max_tokens):
        calls.append(1)
        return original(self, system, user, max_tokens=max_tokens)

    monkeypatch.setattr(FakeProvider, "complete", spy)
    src = RESIDUE_APP

    result = runner.invoke(
        app, ["migrate", str(src), "--json", "--no-validate", "--out", str(tmp_path / "rn")]
    )
    assert result.exit_code == 0, result.output
    summary = json.loads(result.stdout)
    assert calls, "the unmapped classes should have reached the LLM tier"
    assert summary["llm"]["calls"] == len(calls)


def test_a_replaced_marker_takes_the_items_it_still_owes() -> None:
    text = (
        "// ===== REJOX-TODO: 2 item(s) need attention =====\n"
        "// REJOX-TODO(TW_UNSUPPORTED): 2 Tailwind class(es) have no NativeWind mapping\n"
        "// REJOX-TODO(IMAGE_SIZE): injected 100\n"
        "export const x = 1;\n"
    )
    owed = [UnhandledItem(code="TW_STRUCTURAL", snippet="`a` removed\n  <A />")]

    out = strip_resolved_todos(text, {"TW_UNSUPPORTED"}, {"TW_UNSUPPORTED": owed})

    assert "TW_UNSUPPORTED" not in out
    assert "// REJOX-TODO(TW_STRUCTURAL): `a` removed\n//   <A />\n" in out
    assert "REJOX-TODO: 2 item(s)" in out  # TW_STRUCTURAL + IMAGE_SIZE


def test_owed_items_are_never_lost_without_a_marker_to_replace() -> None:
    owed = [UnhandledItem(code="CSS_STRUCTURAL", snippet="dropped")]
    out = strip_resolved_todos("export const x = 1;\n", set(), {"CSS_MODULE": owed})
    assert "REJOX-TODO: 1 item(s)" in out
    assert "// REJOX-TODO(CSS_STRUCTURAL): dropped" in out
