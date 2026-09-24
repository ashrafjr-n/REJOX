"""Structured logging — one JSON line per thing that happened, keyed by run.

Gate E0 asked whether a failed migration can be explained afterwards from what
a deployment retains, and the answer was no: `app/retention.py` was the only
module in the backend that logged anything, so nothing named the stage or the
reason, and a user quoting a job id gave an operator nothing to grep for.

Two rules make the difference, and both are about correlation rather than
volume:

**Every line carries the run and job it belongs to.** They are bound once, in
the process that owns the work, and travel through `contextvars` — so a stage
deep in the pipeline does not have to be handed an id it has no other use for.
`contextvars` rather than a global: an API process serves many requests at once,
and a thread-backend worker runs alongside them in the same process.

**The identity is a digest, never a credential.** `identify()` already returns
`key:<digest>` / `acct:<digest>`; those are safe to log and are exactly what
`{run}/owner` holds, so a log line joins to a run's owner directly. An API key
or an invite code must never reach a log.

Output is JSON on one line, to stdout, which is where a container deployment
collects it. `REJOX_LOG_FORMAT=text` gives a human-readable form for a terminal.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import sys
import time
from contextlib import contextmanager
from typing import Any, Iterator, Optional

_run_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("run_id", default=None)
_job_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("job_id", default=None)
_identity: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("identity", default=None)

logger = logging.getLogger("rejox")


@contextmanager
def bound(
    *,
    run_id: Optional[str] = None,
    job_id: Optional[str] = None,
    identity: Optional[str] = None,
) -> Iterator[None]:
    """Bind ids for everything logged inside this block.

    Restores the previous values on exit, including when the block raises — a
    worker that reuses its process for the next job must not inherit the last
    one's ids and mislabel every line it writes.
    """
    tokens = [
        (_run_id, _run_id.set(run_id) if run_id is not None else None),
        (_job_id, _job_id.set(job_id) if job_id is not None else None),
        (_identity, _identity.set(identity) if identity is not None else None),
    ]
    try:
        yield
    finally:
        for var, token in tokens:
            if token is not None:
                var.reset(token)


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": round(record.created, 3),
            "level": record.levelname.lower(),
            "event": record.getMessage(),
        }
        for key, var in (("runId", _run_id), ("jobId", _job_id), ("identity", _identity)):
            value = var.get()
            if value is not None:
                payload[key] = value
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class _TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        stamp = time.strftime("%H:%M:%S", time.localtime(record.created))
        ids = " ".join(
            f"{name}={var.get()}"
            for name, var in (("run", _run_id), ("job", _job_id))
            if var.get() is not None
        )
        extra = getattr(record, "fields", None)
        tail = " " + " ".join(f"{k}={v}" for k, v in extra.items()) if extra else ""
        return f"{stamp} {record.levelname[:4].lower():5} {ids} {record.getMessage()}{tail}".strip()


def configure() -> None:
    """Install the handler. Idempotent — the API and the worker both call it."""
    if getattr(logger, "_rejox_configured", False):
        return
    handler = logging.StreamHandler(sys.stdout)
    text = os.environ.get("REJOX_LOG_FORMAT", "json").strip().lower() == "text"
    handler.setFormatter(_TextFormatter() if text else _JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(os.environ.get("REJOX_LOG_LEVEL", "INFO").strip().upper() or "INFO")
    # Ours is a complete record; letting it also reach the root handler would
    # print every line twice under uvicorn.
    logger.propagate = False
    logger._rejox_configured = True  # type: ignore[attr-defined]


def event(name: str, **fields: Any) -> None:
    """Log one thing that happened, with its measurements."""
    logger.info(name, extra={"fields": fields})


def failure(name: str, **fields: Any) -> None:
    logger.error(name, extra={"fields": fields})
