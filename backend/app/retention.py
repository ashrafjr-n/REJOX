"""Run-workspace retention — the thing that makes the TTL real.

``workspace.sweep()` has always known how to reap expired runs. Nothing called
it, so nothing was ever reaped: uploaded sources and emitted projects
accumulated on disk indefinitely while the code read as though a retention
policy existed. This module is the caller.

A run workspace holds a stranger's source code, so keeping it forever is a data
question before it is a disk question. The window is
``REJOX_RUN_TTL_SECONDS`` (24h default) and the sweep runs:

  * once at API startup — so a restart after downtime clears the backlog, and
  * every ``REJOX_SWEEP_INTERVAL_SECONDS`` (1h default) thereafter.

Also available as ``rejox sweep`` for a cron-driven deployment that would rather
schedule it externally than have the API process own it.

The sweeper is a daemon thread: it must never keep the process alive at
shutdown, and a failure in it must never take the API down — an unreaped run is
a problem to log, not a reason to stop serving.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

from app.pipeline import workspace

logger = logging.getLogger("rejox.retention")

DEFAULT_SWEEP_INTERVAL_SECONDS = 60 * 60


def sweep_interval_seconds() -> int:
    raw = os.environ.get("REJOX_SWEEP_INTERVAL_SECONDS", "").strip()
    if not raw:
        return DEFAULT_SWEEP_INTERVAL_SECONDS
    try:
        return max(60, int(raw))
    except ValueError:
        return DEFAULT_SWEEP_INTERVAL_SECONDS


def sweep_once() -> list[str]:
    """Reap every run past its TTL. Returns the ids removed; never raises."""
    try:
        removed = workspace.sweep(workspace.ttl_seconds())
    except Exception:  # noqa: BLE001 - a failed sweep must not break the caller
        logger.exception("Run-workspace sweep failed")
        return []
    if removed:
        logger.info(
            "Reaped %d run workspace(s) older than %ds: %s",
            len(removed), workspace.ttl_seconds(), ", ".join(removed),
        )
    return removed


class Reaper:
    """A daemon thread that sweeps on an interval until stopped."""

    def __init__(self, interval: Optional[int] = None) -> None:
        self._interval = interval if interval is not None else sweep_interval_seconds()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread is not None:
            return
        # Sweep immediately: after downtime the backlog is exactly the set of
        # runs that outlived their window while nothing was watching.
        sweep_once()
        self._thread = threading.Thread(target=self._loop, name="rejox-reaper", daemon=True)
        self._thread.start()
        logger.info(
            "Retention active: sweeping every %ds, TTL %ds",
            self._interval, workspace.ttl_seconds(),
        )

    def stop(self) -> None:
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=5)

    def _loop(self) -> None:
        # wait() rather than sleep() so shutdown is immediate instead of taking
        # up to a full interval.
        while not self._stop.wait(self._interval):
            sweep_once()


def disabled() -> bool:
    """Retention off — for a deployment running `rejox sweep` from cron instead."""
    return os.environ.get("REJOX_RETENTION", "").strip().lower() in {"0", "off", "false"}
