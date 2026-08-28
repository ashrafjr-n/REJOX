"""Tests for the sandbox seam (``app/pipeline/sandbox.py``) and the dependency
hardening around it.

The Validator executes `npm install`, `tsc` and Metro against a project derived
from an uploaded file. These tests pin the containment guarantees that make that
safe, and the refusal that keeps the un-contained mode from being reached by
accident.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from app.pipeline import sandbox
from app.pipeline.sandbox import (
    SandboxError,
    SandboxPolicy,
    assert_safe_for_untrusted_input,
    docker_argv,
)
from app.pipeline.scaffold import _build_dependencies, generate_scaffold

DOCKER = SandboxPolicy(mode="docker")


# --- Policy ------------------------------------------------------------------


def test_default_mode_is_direct_and_does_not_contain(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("REJOX_SANDBOX", raising=False)
    policy = SandboxPolicy.from_env()
    assert policy.mode == "direct"
    # Direct mode must never claim to be containment.
    assert policy.contains_untrusted_code is False


def test_docker_mode_contains(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REJOX_SANDBOX", "docker")
    assert SandboxPolicy.from_env().contains_untrusted_code is True


def test_unknown_mode_is_rejected_not_defaulted(monkeypatch: pytest.MonkeyPatch) -> None:
    # A typo'd mode must fail loudly, never silently degrade to `direct`.
    monkeypatch.setenv("REJOX_SANDBOX", "gvisor")
    with pytest.raises(SandboxError):
        SandboxPolicy.from_env()


# --- The refusal -------------------------------------------------------------


def test_untrusted_input_refused_without_containment() -> None:
    with pytest.raises(SandboxError, match="un-sandboxed"):
        assert_safe_for_untrusted_input(SandboxPolicy(mode="direct"))


def test_untrusted_input_allowed_under_docker() -> None:
    assert_safe_for_untrusted_input(DOCKER)  # does not raise


def test_operator_can_accept_the_risk_deliberately() -> None:
    policy = SandboxPolicy(mode="direct", allow_unsandboxed=True)
    assert_safe_for_untrusted_input(policy)  # does not raise


def test_docker_mode_never_falls_back_when_docker_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The dangerous failure mode would be "docker unavailable → run it anyway".
    monkeypatch.setattr(sandbox.shutil, "which", lambda _name: None)
    with pytest.raises(SandboxError, match="not on PATH"):
        sandbox.run(["npm", "install"], Path("/tmp"), 10, policy=DOCKER)


# --- Container flags ---------------------------------------------------------


def test_container_drops_privileges_and_caps_resources() -> None:
    argv = docker_argv(["npm", "install"], Path("/tmp"), network=True, policy=DOCKER)
    joined = " ".join(argv)
    assert "--cap-drop ALL" in joined
    assert "--security-opt no-new-privileges" in joined
    assert "--read-only" in joined
    assert f"--memory={DOCKER.memory}" in joined
    # Without a swap cap the memory limit is not a real ceiling.
    assert f"--memory-swap={DOCKER.memory}" in joined
    assert f"--pids-limit={DOCKER.pids}" in joined
    assert "--rm" in argv
    # Never root inside the container.
    assert any(a.startswith("--user=") and not a.endswith("=0:0") for a in argv)


def test_only_the_run_directory_is_mounted() -> None:
    argv = docker_argv(["npm", "install"], Path("/tmp"), network=True, policy=DOCKER)
    mounts = [argv[i + 1] for i, a in enumerate(argv) if a == "-v"]
    assert mounts == [f"{Path('/tmp').resolve()}:/work"]


def test_network_is_off_unless_the_stage_asks_for_it() -> None:
    install = docker_argv(["npm", "install"], Path("/tmp"), network=True, policy=DOCKER)
    bundle = docker_argv(["npx", "expo", "export"], Path("/tmp"), network=False, policy=DOCKER)
    assert install[install.index("--network") + 1] == "bridge"
    assert bundle[bundle.index("--network") + 1] == "none"


def test_command_runs_in_the_mounted_workdir() -> None:
    argv = docker_argv(["node", "x"], Path("/tmp"), network=False, policy=DOCKER)
    assert argv[argv.index("-w") + 1] == "/work"
    assert argv[-2:] == ["node", "x"]


# --- npm lifecycle scripts ---------------------------------------------------


def test_npm_scripts_are_off_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("REJOX_NPM_ALLOW_SCRIPTS", raising=False)
    assert sandbox.npm_scripts_allowed() is False


def test_npm_scripts_can_be_re_enabled_explicitly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REJOX_NPM_ALLOW_SCRIPTS", "1")
    assert sandbox.npm_scripts_allowed() is True


# --- The Validator actually uses the sandbox ---------------------------------


def test_validator_containerizes_every_command_it_runs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The wiring, not just the argv builder: in docker mode the Validator must
    issue `docker run` for each stage — and only the install stage may have a
    network. A stage that escaped the seam would show up here as a bare `npm`."""
    from app.pipeline import validator

    (tmp_path / "package.json").write_text('{"name":"x"}')
    # A local tsc, so the typecheck stage really runs instead of skipping.
    tsc = tmp_path / "node_modules" / "typescript" / "bin" / "tsc"
    tsc.parent.mkdir(parents=True)
    tsc.write_text("")

    issued: list[list[str]] = []

    class _Proc:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(argv, **kwargs):
        issued.append(argv)
        return _Proc()

    monkeypatch.setattr(sandbox.subprocess, "run", fake_run)
    monkeypatch.setattr(sandbox.shutil, "which", lambda _n: "/usr/local/bin/docker")

    validator.validate_project(tmp_path, install=True, run_bundle=True, policy=DOCKER)

    assert issued, "the Validator ran nothing"
    for argv in issued:
        assert argv[:2] == ["docker", "run"], f"escaped the sandbox: {argv}"

    # All three stages went through, and only install was given a network.
    flat = [" ".join(a) for a in issued]
    assert any("npm install" in c for c in flat)
    assert any("tsc --noEmit" in c for c in flat)
    assert any("expo export" in c for c in flat)

    networked = [a for a in issued if a[a.index("--network") + 1] != "none"]
    assert len(networked) == 1, "exactly one stage may reach the network"
    assert "install" in networked[0], networked[0]

    # Paths handed to the container must be relative, or they would point at
    # host locations that do not exist under /work.
    for argv in issued:
        payload = argv[argv.index(DOCKER.image) + 1:]
        assert not any(part.startswith("/") for part in payload[1:]), payload


def test_install_ignores_dependency_lifecycle_scripts(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from app.pipeline import validator

    (tmp_path / "package.json").write_text('{"name":"x"}')
    issued: list[list[str]] = []

    class _Proc:
        returncode = 0
        stdout = ""
        stderr = ""

    monkeypatch.delenv("REJOX_NPM_ALLOW_SCRIPTS", raising=False)
    monkeypatch.setattr(
        sandbox.subprocess, "run", lambda argv, **kw: (issued.append(argv), _Proc())[1]
    )
    monkeypatch.setattr(sandbox.shutil, "which", lambda _n: "/usr/local/bin/docker")

    validator.validate_project(tmp_path, install=True, run_bundle=False, policy=DOCKER)

    install = next(a for a in issued if "install" in a)
    assert "--ignore-scripts" in install


# --- Carried-over dependency versions ----------------------------------------


@pytest.mark.parametrize(
    "spec",
    [
        "https://evil.example.com/pkg.tgz",
        "git+ssh://git@evil.example.com/pkg.git",
        "github:attacker/pkg",
        "file:../../../etc",
        "npm:other-package@1.0.0",
        "*",
    ],
)
def test_non_registry_version_specs_are_not_carried_over(spec: str) -> None:
    deps, _dev, _overrides = _build_dependencies("stylesheet", None, {"axios": spec})
    assert "axios" not in deps


@pytest.mark.parametrize("spec", ["^1.7.2", "~1.7", "1.7.2", "1", "1.0.0-beta.1"])
def test_plain_registry_ranges_still_carry_over(spec: str) -> None:
    deps, _dev, _overrides = _build_dependencies("stylesheet", None, {"axios": spec})
    assert deps["axios"] == spec


def test_scaffolded_package_json_never_contains_a_url_dependency() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        generate_scaffold(
            out,
            {"project-type": "expo", "styling-engine": "stylesheet"},
            source_dependencies={"axios": "https://evil.example.com/pkg.tgz"},
        )
        pkg = json.loads((out / "package.json").read_text())
        for spec in pkg.get("dependencies", {}).values():
            assert "://" not in spec
            assert not spec.startswith(("file:", "git", "github:", "npm:"))
