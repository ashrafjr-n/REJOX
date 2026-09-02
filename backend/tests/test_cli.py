"""CLI smoke test — the terminal face of the pipeline runs end to end.

Invokes ``rejox migrate --yes --no-validate`` on sample-app (fast: no npm
install / tsc / Metro) and asserts a clean exit plus the expected output tree.
The AI is left disabled (no key, no fake) so this also proves the zero-AI path.
"""

from __future__ import annotations

import io
import re
from pathlib import Path

from rich.console import Console
from typer.testing import CliRunner

from app.cli import _RUN_COMMAND, _project_panel, app

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE = REPO_ROOT / "test-projects" / "sample-app"

runner = CliRunner()


def _unrendered(output: str) -> str:
    """The CLI's text with Rich's layout taken back out.

    Rich wraps to the console width, so where a line breaks depends on the
    terminal — and on values inside the line, like the length of a temp path.
    Asserting on raw output therefore asserts on layout by accident. Stripping
    the box drawing and collapsing whitespace leaves what the CLI *said*; that
    the panel keeps its command on one line is asserted separately, below.
    """
    without_box = re.sub(r"[─-╿]", " ", output)  # the Box Drawing block
    return re.sub(r"\s+", " ", without_box)


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
    assert _RUN_COMMAND in _unrendered(result.output)

    # The RN tree was written with the expected shape.
    assert (out / "App.tsx").is_file()
    assert (out / "package.json").is_file()
    assert (out / "src" / "navigation" / "AppNavigator.tsx").is_file()
    assert (out / "src" / "screens" / "ProductsPage.tsx").is_file()
    assert (out / "src" / "components" / "Button.tsx").is_file()
    # Navigator is complete — no NAV_CONTAINER TODO survives.
    assert "REJOX-TODO(NAV_CONTAINER)" not in (out / "src" / "navigation" / "AppNavigator.tsx").read_text()


def test_the_run_command_survives_a_narrow_terminal() -> None:
    """The run command stays copy-pasteable however long the output path is.

    This is the bug that sat red on master for nine runs: joined as
    ``cd <path> && npx expo start`` the panel wrapped mid-command, and *where*
    it wrapped depended on the path — long enough on a Mac to break harmlessly,
    exactly wrong on CI's shorter ``/tmp/pytest-of-runner/...``. Both lengths
    are pinned here, at the 80 columns a terminal-less CI reports.
    """
    paths = [Path(p) for p in (
        # The path CI actually produced when this broke.
        "/tmp/pytest-of-runner/pytest-0/test_migrate_runs_end_to_end_a0/rn",
        # A macOS temp path, which is longer and used to wrap elsewhere.
        "/private/var/folders/qq/abc123xyz/T/pytest-of-someone/pytest-9/test_a0/rn",
        # A path long enough that it alone fills the panel.
        "/" + "a" * 200 + "/rn",
    )]
    for path in paths:
        buffer = io.StringIO()
        Console(file=buffer, width=80, force_terminal=False).print(_project_panel(path))
        rendered = buffer.getvalue()
        assert _RUN_COMMAND in rendered, f"the run command wrapped for {path!r}:\n{rendered}"


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
