"""Shared test configuration.

The API refuses, by design, to serve an unauthenticated caller or to run an
uploaded project's toolchain without containment. The test suite is a developer
machine running Rejox against its own fixtures, which is exactly the case those
refusals carve out — so it opts in explicitly here rather than weakening the
defaults. Tests that exercise the refusals themselves clear these per-test.
"""

from __future__ import annotations

import pytest

from app import security
from app.pipeline import sandbox


@pytest.fixture(autouse=True, scope="session")
def _dev_server_posture() -> None:
    import os

    os.environ.setdefault("REJOX_ALLOW_ANONYMOUS", "1")
    os.environ.setdefault("REJOX_ALLOW_UNSANDBOXED", "1")
    # The suite deliberately starts several migrations at once and asserts on
    # their event streams. The production ceiling protects one box from real
    # load; here it would just make tests fail by arrival order.
    os.environ.setdefault("REJOX_MAX_CONCURRENT_MIGRATIONS", "64")
    # Job-state helpers poll at 20 req/s, far above what a real client does
    # (the UI follows the SSE stream instead). Lift the read budget so the
    # suite measures the pipeline, not the limiter.
    os.environ.setdefault("REJOX_RATE_READ", "100000")


@pytest.fixture(autouse=True)
def _reset_mount_probes() -> None:
    """The sandbox proves a run directory is visible once per process and
    remembers it. Tests reuse `tmp_path` names across a session, so without this
    one test's proof could stand in for another's."""
    sandbox.reset_mount_probes()


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    """Budgets are per-identity and process-wide; without this, tests would
    charge each other's requests to the same anonymous bucket and start failing
    in whatever order they happen to run."""
    security.limiter.reset()
    yield
    security.limiter.reset()
