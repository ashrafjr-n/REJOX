"""CLI smoke test — the terminal face of the pipeline runs end to end.

Invokes ``rejox migrate --yes --no-validate`` on sample-app (fast: no npm
install / tsc / Metro) and asserts a clean exit plus the expected output tree.
The AI is left disabled (no key, no fake) so this also proves the zero-AI path.
"""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from app.cli import app

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE = REPO_ROOT / "test-projects" / "sample-app"

runner = CliRunner()


def test_migrate_runs_end_to_end_and_writes_the_rn_tree(tmp_path, monkeypatch) -> None:
    # Zero-AI path: no key, no fake provider selected.
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    out = tmp_path / "rn"

    result = runner.invoke(
        app, ["migrate", str(SAMPLE), "--yes", "--no-validate", "--out", str(out)]
    )

    assert result.exit_code == 0, result.output

    # The report + thesis are on screen.
    assert "Migration Report" in result.output
    assert "COVERAGE" in result.output
    assert "Actual LLM calls: 0" in result.output  # AI disabled → zero
    assert "npx expo start" in result.output

    # The RN tree was written with the expected shape.
    assert (out / "App.tsx").is_file()
    assert (out / "package.json").is_file()
    assert (out / "src" / "navigation" / "AppNavigator.tsx").is_file()
    assert (out / "src" / "screens" / "ProductsPage.tsx").is_file()
    assert (out / "src" / "components" / "Button.tsx").is_file()
    # Navigator is complete — no NAV_CONTAINER TODO survives.
    assert "REJOX-TODO(NAV_CONTAINER)" not in (out / "src" / "navigation" / "AppNavigator.tsx").read_text()


def test_migrate_with_offline_fake_provider_makes_exactly_one_llm_call(tmp_path, monkeypatch) -> None:
    # The one legitimate reasoning call: navigator shape, via the offline provider.
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("REJOX_AI_PROVIDER", "fake")
    out = tmp_path / "rn"

    result = runner.invoke(
        app, ["migrate", str(SAMPLE), "--yes", "--no-validate", "--out", str(out)]
    )
    assert result.exit_code == 0, result.output
    assert "Actual LLM calls: 1" in result.output          # the thesis
    assert "proposed" in result.output and "tabs" in result.output


def test_migrate_rejects_a_missing_project() -> None:
    result = runner.invoke(app, ["migrate", "/does/not/exist", "--yes", "--no-validate"])
    assert result.exit_code == 1
    assert "Not a directory" in result.output
