"""Sandbox — the single seam through which Rejox executes untrusted toolchains.

The Validator runs `npm install`, `tsc` and Metro against a project **derived
from a file a stranger uploaded**. That is arbitrary-code execution by design:
npm runs dependency lifecycle scripts, and a dependency version spec can point
at any tarball or git repo. Every one of those commands therefore goes through
:func:`run` and nowhere else.

Two modes, and the difference between them is stated plainly:

``docker`` (the only real sandbox)
    Each command runs in a throw-away container: no capabilities, no privilege
    escalation, a non-root user, a pid ceiling, hard memory/CPU limits, and
    **the network switched off for every stage that does not need it** (only
    ``npm install`` gets network). The run directory is the only writable mount.

``direct`` (development convenience — NOT a sandbox)
    The command runs as the Rejox process itself. Fine for the CLI and the test
    suite on a developer machine; unacceptable for a server that accepts
    uploads. It applies what a plain process can (no core dumps, a file-size
    ceiling, a timeout) and is honest that this is not containment.

Because the weak mode must never be reached by accident, the API refuses to
serve migrations in ``direct`` mode unless the operator has explicitly accepted
the risk (see :func:`assert_safe_for_untrusted_input`).

    policy = SandboxPolicy.from_env()
    run(["npm", "install"], cwd=out_dir, timeout=900, network=True, policy=policy)
"""

from __future__ import annotations

import os
import resource
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

Mode = Literal["direct", "docker"]

# Default container image. Node 20 covers Expo 52's toolchain; pinned by digest
# in production via REJOX_SANDBOX_IMAGE.
DEFAULT_IMAGE = "node:20-bookworm-slim"
DEFAULT_MEMORY = "4g"
DEFAULT_CPUS = "2"
DEFAULT_PIDS = 512
# Ceiling on any single file a sandboxed command may write (bundle output,
# logs, a malicious dependency filling the disk). 2 GiB.
DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024


class SandboxError(RuntimeError):
    """The sandbox could not be established — never a reason to fall back."""


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class SandboxPolicy:
    """How untrusted commands are executed. Read once from the environment."""

    mode: Mode = "direct"
    image: str = DEFAULT_IMAGE
    memory: str = DEFAULT_MEMORY
    cpus: str = DEFAULT_CPUS
    pids: int = DEFAULT_PIDS
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES
    # Operator has explicitly accepted running untrusted code un-contained.
    allow_unsandboxed: bool = False

    @classmethod
    def from_env(cls) -> "SandboxPolicy":
        raw_mode = os.environ.get("REJOX_SANDBOX", "direct").strip().lower()
        if raw_mode not in ("direct", "docker"):
            raise SandboxError(
                f"REJOX_SANDBOX={raw_mode!r} is not a mode; use 'docker' or 'direct'."
            )
        return cls(
            mode=raw_mode,  # type: ignore[arg-type]
            image=os.environ.get("REJOX_SANDBOX_IMAGE", DEFAULT_IMAGE).strip() or DEFAULT_IMAGE,
            memory=os.environ.get("REJOX_SANDBOX_MEMORY", DEFAULT_MEMORY).strip() or DEFAULT_MEMORY,
            cpus=os.environ.get("REJOX_SANDBOX_CPUS", DEFAULT_CPUS).strip() or DEFAULT_CPUS,
            pids=_env_int("REJOX_SANDBOX_PIDS", DEFAULT_PIDS),
            max_file_bytes=_env_int("REJOX_SANDBOX_MAX_FILE_BYTES", DEFAULT_MAX_FILE_BYTES),
            allow_unsandboxed=_env_flag("REJOX_ALLOW_UNSANDBOXED"),
        )

    @property
    def contains_untrusted_code(self) -> bool:
        """True only when the mode actually isolates the executed process."""
        return self.mode == "docker"


def npm_scripts_allowed() -> bool:
    """Whether dependency lifecycle scripts may run during install.

    Off by default in every mode. A dependency's ``postinstall`` is arbitrary
    code from a tree the uploader influences, and Rejox only needs the package
    files to typecheck and bundle. Kept as an escape hatch for a project that
    genuinely cannot install without them — never for untrusted input.
    """
    return _env_flag("REJOX_NPM_ALLOW_SCRIPTS")


def assert_safe_for_untrusted_input(policy: Optional[SandboxPolicy] = None) -> None:
    """Refuse to accept stranger-supplied projects without real containment.

    Called by the API before it will start a migration. The CLI does not call
    this: a developer running Rejox on their own project is not the threat model.
    """
    policy = policy or SandboxPolicy.from_env()
    if policy.contains_untrusted_code:
        return
    if policy.allow_unsandboxed:
        return
    raise SandboxError(
        "Refusing to run untrusted project code un-sandboxed. The Validator "
        "executes `npm install` and Metro against an uploaded project, which is "
        "arbitrary code execution. Set REJOX_SANDBOX=docker (recommended), or "
        "set REJOX_ALLOW_UNSANDBOXED=1 to accept the risk deliberately."
    )


# --- direct mode -------------------------------------------------------------


def _rlimits(max_file_bytes: int):
    """Limits a plain child process can carry. Deliberately excludes RLIMIT_AS:
    V8 reserves a huge virtual address space, so an address-space cap kills Node
    outright rather than limiting it. Real memory limits live in docker mode."""

    def apply() -> None:  # pragma: no cover - runs in the forked child
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_file_bytes, max_file_bytes))

    return apply


def _run_direct(
    cmd: list[str], cwd: Path, timeout: int, policy: SandboxPolicy
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=timeout,
        preexec_fn=_rlimits(policy.max_file_bytes),
    )


# --- docker mode -------------------------------------------------------------


def docker_argv(
    cmd: list[str], cwd: Path, *, network: bool, policy: SandboxPolicy
) -> list[str]:
    """Build the `docker run` argv for one sandboxed command.

    Split out from :func:`run` so the containment flags are directly testable
    without a running Docker daemon.
    """
    uid, gid = os.getuid(), os.getgid()
    return [
        "docker", "run", "--rm",
        # No ambient privilege: no capabilities, no way to regain any.
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        f"--user={uid}:{gid}",
        # Network is opt-in per stage; only `npm install` needs it.
        "--network", "bridge" if network else "none",
        f"--memory={policy.memory}",
        # Denying swap makes --memory a real ceiling instead of a soft one.
        f"--memory-swap={policy.memory}",
        f"--cpus={policy.cpus}",
        f"--pids-limit={policy.pids}",
        # Only the run directory is writable; the image itself is not.
        "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
        "-v", f"{cwd.resolve()}:/work",
        "-w", "/work",
        "-e", "HOME=/tmp",
        "-e", "npm_config_cache=/tmp/.npm",
        "-e", "CI=1",
        policy.image,
        *cmd,
    ]


def _run_docker(
    cmd: list[str], cwd: Path, timeout: int, *, network: bool, policy: SandboxPolicy
) -> subprocess.CompletedProcess[str]:
    if shutil.which("docker") is None:
        raise SandboxError(
            "REJOX_SANDBOX=docker but `docker` is not on PATH. Refusing to fall "
            "back to un-sandboxed execution."
        )
    argv = docker_argv(cmd, cwd, network=network, policy=policy)
    proc = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    # A container that never started is a sandbox failure, not a tool failure —
    # surfacing it as `npm install failed` would be a lie.
    if proc.returncode == 125:
        raise SandboxError(
            f"Docker could not start the sandbox container:\n{proc.stderr.strip()}"
        )
    return proc


# --- entry point -------------------------------------------------------------


def run(
    cmd: list[str],
    cwd: Path,
    timeout: int,
    *,
    network: bool = False,
    policy: Optional[SandboxPolicy] = None,
) -> subprocess.CompletedProcess[str]:
    """Execute one untrusted command under the configured policy.

    Args:
        cmd: argv. In docker mode this runs inside the container, so it must
            name tools the image provides (``node``, ``npm``, ``npx``) rather
            than absolute host paths.
        cwd: the run directory — the only writable mount in docker mode.
        timeout: wall-clock ceiling, enforced in both modes.
        network: whether this stage may reach the network. Default False;
            only dependency installation should pass True.
    """
    policy = policy or SandboxPolicy.from_env()
    if policy.mode == "docker":
        return _run_docker(cmd, cwd, timeout, network=network, policy=policy)
    return _run_direct(cmd, cwd, timeout, policy)
