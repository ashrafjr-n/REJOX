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


# --- What the summary says has to be what is true -------------------------------


def _web_only_project(root: Path) -> Path:
    """A router-less app with the residue tsc and Metro both accept."""
    (root / "src").mkdir(parents=True)
    (root / "package.json").write_text(json.dumps({
        "name": "web-only", "dependencies": {"react": "^18.2.0", "react-dom": "^18.2.0"},
    }))
    (root / "src" / "main.tsx").write_text(
        'import { createRoot } from "react-dom/client";\nimport App from "./App";\n'
        'createRoot(document.getElementById("root")!).render(<App />);\n'
    )
    (root / "src" / "App.tsx").write_text(
        "export default function App() {\n"
        "  document.title = 'Home';\n"
        "  return <table><tbody><tr><td>cell</td></tr></tbody></table>;\n"
        "}\n"
    )
    return root


def test_runtime_risks_are_named_next_to_a_green_run(tmp_path, monkeypatch) -> None:
    """`<table>` and `document` type-check (Expo's tsconfig carries the DOM lib)
    and bundle; they throw on the device. Exit 0 must not read as "it works"."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    src = _web_only_project(tmp_path / "web-only")

    result = runner.invoke(
        app, ["migrate", str(src), "--json", "--no-validate", "--out", str(tmp_path / "rn")]
    )
    assert result.exit_code == 0, result.stderr
    summary = MigrationSummary.model_validate_json(result.stdout)
    assert {(r.file, r.code) for r in summary.runtimeRisks} == {
        ("src/App.tsx", "WEB_GLOBAL"), ("src/App.tsx", "WEB_ONLY_ELEMENT"),
    }
    assert "Runtime risks" in result.stderr


def test_the_todo_count_is_the_files_own_count(tmp_path, monkeypatch) -> None:
    """The summary, REJOX-REPORT.md and every file's banner state one number."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    out = tmp_path / "rn"

    result = runner.invoke(app, ["migrate", str(SAMPLE), "--json", "--no-validate", "--out", str(out)])
    assert result.exit_code == 0, result.stderr
    summary = MigrationSummary.model_validate_json(result.stdout)

    banners = [
        int(m.group(1))
        for f in out.rglob("*.ts*") if "node_modules" not in f.parts
        for m in [re.search(r"===== REJOX-TODO: (\d+) item", f.read_text())] if m
    ]
    assert summary.todoCount == sum(banners) > 0
    assert f"- REJOX-TODO items: **{summary.todoCount}**" in (out / "REJOX-REPORT.md").read_text()
    assert "will resolve" not in (out / "REJOX-REPORT.md").read_text()


def test_no_cache_lookup_is_not_a_zero_hit_rate(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    result = runner.invoke(
        app, ["migrate", str(SAMPLE), "--yes", "--no-validate", "--out", str(tmp_path / "rn")]
    )
    assert result.exit_code == 0, result.output
    assert "0 lookup (n/a)" in _unrendered(result.output)
    assert "(0%)" not in result.output


def test_a_key_whose_provider_fails_is_not_reported_as_no_key(tmp_path, monkeypatch) -> None:
    import rejox.ai.config as ai_config

    monkeypatch.setenv("GEMINI_API_KEY", "set-but-broken")
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)

    def broken(*_a, **_k):
        raise RuntimeError("SDK missing")

    monkeypatch.setattr(ai_config, "get_provider", broken)
    result = runner.invoke(
        app, ["migrate", str(SAMPLE), "--yes", "--no-validate", "--out", str(tmp_path / "rn")]
    )
    assert result.exit_code == 0, result.output
    said = _unrendered(result.output)
    assert "GEMINI_API_KEY is set, but the Gemini provider could not start: SDK missing" in said
    assert "no GEMINI_API_KEY" not in said


def test_an_error_in_a_file_with_no_todo_is_called_a_bug(tmp_path, monkeypatch) -> None:
    """"All map to known residue" used to be printed, never checked."""
    from rejox.models.validation import Diagnostic

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    failed = ValidationResult(
        passed=False, installed=True,
        typecheck=StageResult(
            ran=True, passed=False, errorCount=1,
            diagnostics=[Diagnostic(source="typecheck", file="src/nowhere.tsx", line=1,
                                    code="TS2304", message="Cannot find name 'x'.")],
        ),
        bundle=StageResult(),
    )
    monkeypatch.setattr(cli, "validate_project", lambda *a, **k: failed)

    result = runner.invoke(app, ["migrate", str(SAMPLE), "--yes", "--out", str(tmp_path / "rn")])
    assert result.exit_code == 1, result.output
    said = _unrendered(result.output)
    assert "0 of 1 in files with a REJOX-TODO" in said
    assert "a Rejox bug" in said
    assert "all map to known residue" not in said


# --- Failing well: --json, partial output, files that did not convert ----------


def test_json_reports_a_usage_error_as_json() -> None:
    from rejox.models.summary import MigrationFailure

    result = runner.invoke(app, ["migrate", "/does/not/exist", "--json"])
    assert result.exit_code == 2
    failure = MigrationFailure.model_validate_json(result.stdout)  # nothing but JSON
    assert failure.exitCode == 2 and "Not a directory" in failure.error


def test_json_reports_an_internal_error_as_json(tmp_path, monkeypatch) -> None:
    from rejox.models.summary import MigrationFailure

    def boom(_path):
        raise RuntimeError("boom")

    monkeypatch.setattr(cli, "build_knowledge_graph", boom)
    result = runner.invoke(app, ["migrate", str(SAMPLE), "--json", "--out", str(tmp_path / "rn")])
    assert result.exit_code == 70
    failure = MigrationFailure.model_validate_json(result.stdout)
    assert failure.exitCode == 70 and "boom" in failure.error


def _emit_then_crash(monkeypatch) -> None:
    def half_written(plan, answers, kg, out_dir, **kwargs):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "App.tsx").write_text("// half of a project\n")
        raise RuntimeError("crashed mid-emit")

    monkeypatch.setattr(cli, "emit_project", half_written)


def test_an_internal_error_removes_the_half_written_output_it_created(tmp_path, monkeypatch) -> None:
    """A half-written project looks like a whole one. One this run created goes."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    _emit_then_crash(monkeypatch)
    out = tmp_path / "rn"

    result = runner.invoke(app, ["migrate", str(SAMPLE), "--yes", "--no-validate", "--out", str(out)])
    assert result.exit_code == 70
    assert not out.exists()
    assert "was removed" in _unrendered(result.output)


def test_an_internal_error_never_deletes_a_directory_it_did_not_create(tmp_path, monkeypatch) -> None:
    """--force writes beside the user's own files; those are never deleted."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    _emit_then_crash(monkeypatch)
    out = tmp_path / "rn"
    out.mkdir()
    (out / "keep.txt").write_text("mine")

    result = runner.invoke(
        app, ["migrate", str(SAMPLE), "--yes", "--no-validate", "--force", "--out", str(out)]
    )
    assert result.exit_code == 70
    assert (out / "keep.txt").read_text() == "mine"
    assert (out / "REJOX-INCOMPLETE.md").is_file()


def test_a_file_that_failed_to_convert_is_shown_not_just_counted(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    src = _web_only_project(tmp_path / "app")
    (src / "src" / "util.ts").write_text("export const x = (;\n")  # a syntax error

    result = runner.invoke(
        app, ["migrate", str(src), "--yes", "--no-validate", "--out", str(tmp_path / "rn")]
    )
    assert result.exit_code == 0, result.output
    said = _unrendered(result.output)
    assert "1 file(s) could not be converted" in said
    assert "src/util.ts" in said
    assert "(1 failed to convert)" in said
    report = (tmp_path / "rn" / "REJOX-REPORT.md").read_text()
    [line] = [l for l in report.splitlines() if l.startswith("- `src/util.ts`")]
    assert "syntactic error" in line  # the whole reason, on its one list line


def test_a_one_option_question_is_stated_not_asked(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REJOX_AI_PROVIDER", raising=False)
    result = runner.invoke(
        app, ["migrate", str(SAMPLE), "--yes", "--no-validate", "--out", str(tmp_path / "rn")]
    )
    assert result.exit_code == 0, result.output
    said = _unrendered(result.output)
    assert "Expo — the one option this version supports" in said
    assert "Bare React Native" not in said and "Expo Router" not in said
