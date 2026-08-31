"""Section A of docs/PRE-LAUNCH-CHECKLIST.md, as tests against a live daemon.

`test_sandbox.py` proves the argv and the refusals without Docker. That is not
the same claim: a flag can be present in `docker run`'s argument list and still
not be in effect, and the checklist says so — "a passing unit test is not
evidence for a gate that says *against a live daemon*". These tests are that
evidence, re-run by CI so a signature cannot quietly rot.

Skipped automatically wherever no daemon answers, so `pytest` on a laptop
without Docker behaves as before. Marked `sandbox_live` so the fast job can
deselect them by name rather than by accident.

**What these cannot cover.** They run as a process on the host, so every path
they hand the daemon is a path the daemon already shares — the sibling-container
mismatch (A1's negative control) cannot occur here. `test_sandbox.py` covers the
refusal with a fake daemon, and the compose job in CI covers the real geometry:
a worker in a container asking the host's daemon to mount a path.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from app.pipeline.sandbox import SandboxError, SandboxPolicy, run

pytestmark = pytest.mark.sandbox_live

# Small on purpose: the ceilings must be reached in seconds, not minutes. The
# checklist's A6 note exists because a 4g limit took longer to hit than the
# probe's timeout allowed, and the gate then reported a timeout instead of a
# verdict.
LIVE = SandboxPolicy(mode="docker", memory="512m", cpus="1", pids=64)


def _daemon_is_up() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        proc = subprocess.run(
            ["docker", "version", "--format", "{{.Server.Version}}"],
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return proc.returncode == 0


@pytest.fixture(scope="module", autouse=True)
def _requires_a_daemon() -> None:
    if not _daemon_is_up():
        pytest.skip("no Docker daemon — these gates assert against a live one")


@pytest.fixture(scope="module", autouse=True)
def _image_is_present(_requires_a_daemon: None) -> None:
    """Pull once, so the first test's timeout is not really a download."""
    subprocess.run(["docker", "pull", "--quiet", LIVE.image], capture_output=True, timeout=600)


# --- A1: the mount is real ---------------------------------------------------


def test_the_run_directory_is_visible_inside_the_container(tmp_path: Path) -> None:
    (tmp_path / "canary.txt").write_text("canary-a1")
    proc = run(["cat", "canary.txt"], tmp_path, 120, policy=LIVE)
    assert proc.returncode == 0, proc.stderr
    # Empty stdout with a zero exit is the dangerous failure: a different, empty
    # directory was mounted and every stage would validate nothing.
    assert proc.stdout.strip() == "canary-a1"


def test_the_container_writes_where_the_host_can_read_it(tmp_path: Path) -> None:
    """The other direction: emitted files must land in the run workspace, or a
    migration would 'succeed' and produce nothing to download."""
    run(["sh", "-c", "echo from-inside > written.txt"], tmp_path, 120, policy=LIVE)
    assert (tmp_path / "written.txt").read_text().strip() == "from-inside"


# --- A2: no privilege --------------------------------------------------------


def test_the_container_is_not_root_and_holds_no_capabilities(tmp_path: Path) -> None:
    ids = run(["id"], tmp_path, 120, policy=LIVE).stdout
    assert "uid=0(" not in ids and not ids.startswith("uid=0 "), ids

    status = run(
        ["sh", "-c", 'grep -E "^(CapEff|NoNewPrivs)" /proc/self/status'],
        tmp_path, 120, policy=LIVE,
    ).stdout
    assert "CapEff:\t0000000000000000" in status, status
    assert "NoNewPrivs:\t1" in status, status


# --- A3: only the run directory is writable ----------------------------------


def test_only_the_run_directory_is_writable(tmp_path: Path) -> None:
    proc = run(
        ["sh", "-c", "touch /etc/probe-a3; echo etc=$?; touch /work/probe-a3; echo work=$?"],
        tmp_path, 120, policy=LIVE,
    )
    assert "etc=1" in proc.stdout, proc.stdout
    assert "Read-only file system" in proc.stderr, proc.stderr
    assert "work=0" in proc.stdout, proc.stdout


# --- A4: network per stage ---------------------------------------------------


_LOOKUP = 'require("dns").lookup("registry.npmjs.org", e => console.log(e ? "BLOCKED" : "REACHED"))'


def test_a_stage_that_did_not_ask_for_the_network_does_not_get_one(tmp_path: Path) -> None:
    proc = run(["node", "-e", _LOOKUP], tmp_path, 120, network=False, policy=LIVE)
    assert proc.stdout.strip() == "BLOCKED", proc.stdout


def test_the_install_stage_still_reaches_the_registry(tmp_path: Path) -> None:
    """The other half, so nobody 'fixes' a red line above by opening the network
    for every stage."""
    proc = run(["node", "-e", _LOOKUP], tmp_path, 120, network=True, policy=LIVE)
    assert proc.stdout.strip() == "REACHED", proc.stdout


# --- A5 / A6: resource ceilings ----------------------------------------------


def test_the_pid_ceiling_stops_a_process_storm(tmp_path: Path) -> None:
    """Deliberately a bounded storm, not a fork bomb: if the ceiling is NOT in
    effect a fork bomb takes the host down and the test destroys its own
    evidence."""
    proc = run(
        ["sh", "-c", "i=0; while [ $i -lt 500 ]; do sleep 5 & i=$((i+1)); done; echo spawned=$i"],
        tmp_path, 180, policy=LIVE,
    )
    assert "spawned=500" not in proc.stdout, "the pid ceiling did not apply"
    assert any(
        m in proc.stderr
        for m in ("Cannot fork", "can't fork", "Resource temporarily unavailable")
    ), proc.stderr


def test_the_memory_ceiling_is_real_and_the_host_survives(tmp_path: Path) -> None:
    proc = run(
        ["node", "-e", "const a=[]; for(;;) a.push(Buffer.alloc(32*1024*1024,1))"],
        tmp_path, 300, policy=LIVE,
    )
    # 137 = killed by SIGKILL, which is the OOM killer hitting --memory. Without
    # --memory-swap matching it, the container would swap instead and the host
    # would degrade rather than the container dying.
    assert proc.returncode == 137, f"exit {proc.returncode}\n{proc.stderr}"

    # The daemon is still answering: the ceiling contained the blast.
    assert _daemon_is_up()


# --- A7: no silent degradation -----------------------------------------------


def test_an_unreachable_daemon_refuses_instead_of_running_uncontained(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PATH", "/nonexistent")
    with pytest.raises(SandboxError, match="not on PATH"):
        run(["echo", "hi"], tmp_path, 30, policy=LIVE)
