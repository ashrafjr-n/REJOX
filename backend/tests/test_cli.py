"""CLI smoke test — the terminal face of the pipeline runs end to end.

Invokes ``rejox migrate --yes --no-validate`` on sample-app (fast: no npm
install / tsc / Metro) and asserts a clean exit plus the expected output tree.
The AI is left disabled (no key, no fake) so this also proves the zero-AI path.
"""

from __future__ import annotations

import io
import json
import re
from pathlib import Path

from rich.console import Console
from typer.testing import CliRunner

from rejox import cli, workers
from rejox.cli import _RUN_COMMAND, _project_panel, app
from rejox.models.knowledge_graph import KnowledgeGraph
from rejox.models.summary import MigrationSummary
from rejox.models.validation import StageResult, ValidationResult

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
    assert result.exit_code == 2  # usage error
    assert "Not a directory" in result.output
    assert "Traceback" not in result.output


def test_export_graph_writes_a_loadable_graph_with_a_portable_root(tmp_path) -> None:
    out = tmp_path / "sample-app.kg.json"
    result = runner.invoke(app, ["export-graph", "--project", str(SAMPLE), "--out", str(out)])
    assert result.exit_code == 0, result.output

    kg = KnowledgeGraph.model_validate(json.loads(out.read_text(encoding="utf-8")))
    assert len(kg.components) == 21
    # The whole point of the command: no machine's home directory in the file.
    assert kg.project.root == "test-projects/sample-app"


def test_export_graph_is_byte_deterministic(tmp_path) -> None:
    first, second = (tmp_path / "a.json", tmp_path / "b.json")
    for path in (first, second):
        assert runner.invoke(
            app, ["export-graph", "--project", str(SAMPLE), "--out", str(path)]
        ).exit_code == 0
    assert first.read_text(encoding="utf-8") == second.read_text(encoding="utf-8")


def test_export_graph_rejects_a_missing_project() -> None:
    result = runner.invoke(app, ["export-graph", "--project", "/does/not/exist"])
    assert result.exit_code == 1
    assert "Not a directory" in result.output


# --- the exit-code contract (see _EXIT_CODES_HELP) ----------------------------


def test_version_prints_the_installed_version() -> None:
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert re.fullmatch(r"rejox \d+\.\d+\.\d+\S*\n", result.output), result.output


def test_a_non_empty_out_is_refused_without_force(tmp_path) -> None:
    out = tmp_path / "rn"
    out.mkdir()
    (out / "keep.txt").write_text("mine")
    result = runner.invoke(app, ["migrate", str(SAMPLE), "--yes", "--out", str(out)])
    assert result.exit_code == 2
    assert "--force" in result.output
    assert (out / "keep.txt").read_text() == "mine"


def test_the_default_out_is_next_to_where_it_runs(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    assert cli._default_out(SAMPLE) == tmp_path / "sample-app-native"


def test_json_prints_only_the_summary_on_stdout(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    out = tmp_path / "rn"
    out.mkdir()
    (out / "keep.txt").write_text("mine")

    result = runner.invoke(
        app, ["migrate", str(SAMPLE), "--no-validate", "--json", "--force", "--out", str(out)]
    )

    assert result.exit_code == 0, result.stderr
    summary = MigrationSummary.model_validate_json(result.stdout)  # nothing but JSON
    assert summary.exitCode == 0
    assert summary.output == str(out)
    assert summary.filesConverted > 0
    assert summary.validation is None and summary.scores is None  # --no-validate
    assert summary.llm.calls == 0
    assert "Migration Report" in result.stderr  # progress still shown, on stderr
    assert (out / "keep.txt").read_text() == "mine"  # --force keeps what was there


def test_a_failed_validation_exits_1(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    failed = ValidationResult(
        passed=False, installed=True,
        typecheck=StageResult(ran=True, passed=False, errorCount=1),
        bundle=StageResult(),
    )
    monkeypatch.setattr(cli, "validate_project", lambda *a, **k: failed)

    result = runner.invoke(app, ["migrate", str(SAMPLE), "--yes", "--out", str(tmp_path / "rn")])
    assert result.exit_code == 1, result.output


def test_a_project_with_no_components_exits_4(tmp_path) -> None:
    project = tmp_path / "not-react"
    (project / "src").mkdir(parents=True)
    (project / "package.json").write_text('{"name": "not-react"}')
    (project / "src" / "util.ts").write_text("export const add = (a: number, b: number) => a + b;\n")

    result = runner.invoke(app, ["migrate", str(project), "--yes", "--out", str(tmp_path / "rn")])
    assert result.exit_code == 4, result.output
    assert "Nothing to migrate" in result.output


def test_a_missing_worker_bundle_exits_3_before_any_work(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(workers, "WORKERS_DIR", tmp_path / "empty")
    result = runner.invoke(app, ["migrate", str(SAMPLE), "--yes", "--out", str(tmp_path / "rn")])
    assert result.exit_code == 3, result.output
    assert "bundle is missing" in _unrendered(result.output)
    assert not (tmp_path / "rn").exists()


def test_an_internal_error_is_one_line_and_debug_shows_it(tmp_path, monkeypatch) -> None:
    def boom(_path):
        raise RuntimeError("boom")

    monkeypatch.setattr(cli, "build_knowledge_graph", boom)
    args = ["migrate", str(SAMPLE), "--yes", "--out", str(tmp_path / "rn")]

    result = runner.invoke(app, args)
    assert result.exit_code == 70
    assert "Internal error (RuntimeError): boom" in result.output
    assert "--debug" in result.output

    debug = runner.invoke(app, ["--debug", *args])
    assert isinstance(debug.exception, RuntimeError)  # the real traceback, not a message


def test_doctor_is_ready_here_and_names_what_is_missing(tmp_path, monkeypatch) -> None:
    assert runner.invoke(app, ["doctor"]).exit_code == 0

    monkeypatch.setattr(workers, "WORKERS_DIR", tmp_path / "empty")
    result = runner.invoke(app, ["doctor"])
    assert result.exit_code == 3
    assert "Not ready" in result.output


def test_internal_commands_are_hidden_but_still_run() -> None:
    listed = runner.invoke(app, ["--help"]).output
    for name in ("export-showcase", "export-graph", "sweep"):
        assert name not in listed
    assert runner.invoke(app, ["sweep", "--help"]).exit_code == 0
