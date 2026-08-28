"""API authentication and rate limiting.

The pipeline is expensive in ways an anonymous caller should never be able to
spend freely: `/api/migrate` installs a dependency tree, type-checks and bundles
a project, and the AI Resolution Engine spends a metered Gemini quota. So the
HTTP surface has two gates, both deliberately simple:

**Identity** — a shared API key, sent as ``Authorization: Bearer <key>`` or
``X-API-Key``. Keys come from ``REJOX_API_KEYS`` (comma-separated). This is not
user accounts; it is the smallest thing that stops the endpoint being open to
the internet, and the identity it establishes is what the rate limiter counts.

**Budget** — a fixed-window limit per identity, stricter for the stages that
cost real money or CPU than for reads.

Both are honest about their scope: the counters live in this process, like the
job store. Behind more than one worker, each worker enforces its own share of
the limit — a shared store (Redis) is the fix, and until then the deployment is
single-worker.

Refusing by default is the point: with no keys configured the protected
endpoints return 503 explaining what to set, rather than quietly serving
everyone. ``REJOX_ALLOW_ANONYMOUS=1`` opts a developer machine out.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import threading
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, Request

# Fixed-window budgets, per identity. Reads are cheap; the pipeline stages that
# install dependencies or spend LLM quota are not.
DEFAULT_WINDOW_SECONDS = 60
DEFAULT_READ_LIMIT = 300
DEFAULT_UPLOAD_LIMIT = 10
DEFAULT_PIPELINE_LIMIT = 20
DEFAULT_MIGRATE_LIMIT = 3
# Migrations are the heavy stage; more than a few at once will exhaust the box
# regardless of the per-minute budget.
DEFAULT_MAX_CONCURRENT_MIGRATIONS = 2


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


# --- Identity ----------------------------------------------------------------


def _configured_keys() -> list[str]:
    raw = os.environ.get("REJOX_API_KEYS", "")
    return [k.strip() for k in raw.split(",") if k.strip()]


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _presented_key(request: Request) -> Optional[str]:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.headers.get("x-api-key", "").strip() or None


def identify(request: Request) -> str:
    """Authenticate the caller and return the identity the limiter counts.

    Returns the key's digest prefix for an authenticated caller, or
    ``ip:<addr>`` when anonymous access is explicitly allowed.
    """
    keys = _configured_keys()
    if not keys:
        if _env_flag("REJOX_ALLOW_ANONYMOUS"):
            return f"ip:{request.client.host if request.client else 'unknown'}"
        raise HTTPException(
            status_code=503,
            detail=(
                "This Rejox server has no API keys configured, so it will not "
                "serve requests. Set REJOX_API_KEYS (comma-separated), or "
                "REJOX_ALLOW_ANONYMOUS=1 for a local development server."
            ),
        )

    presented = _presented_key(request)
    if presented is None:
        raise HTTPException(
            status_code=401,
            detail="Missing API key. Send `Authorization: Bearer <key>` or `X-API-Key`.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Compare digests in constant time so a wrong key leaks no timing signal.
    presented_digest = _digest(presented)
    for key in keys:
        if hmac.compare_digest(presented_digest, _digest(key)):
            return f"key:{presented_digest[:16]}"
    raise HTTPException(status_code=401, detail="Invalid API key.")


# --- Rate limiting -----------------------------------------------------------


@dataclass
class _Window:
    started: float
    count: int


class RateLimiter:
    """Fixed-window counter, keyed by (bucket, identity). Process-local."""

    def __init__(self, window_seconds: int = DEFAULT_WINDOW_SECONDS) -> None:
        self._window = window_seconds
        self._lock = threading.Lock()
        self._windows: dict[tuple[str, str], _Window] = {}

    def check(self, bucket: str, identity: str, limit: int) -> None:
        """Count one request; raise 429 when the identity is over budget."""
        now = time.monotonic()
        key = (bucket, identity)
        with self._lock:
            window = self._windows.get(key)
            if window is None or now - window.started >= self._window:
                self._windows[key] = _Window(started=now, count=1)
                return
            if window.count >= limit:
                retry_after = max(1, int(self._window - (now - window.started)))
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"Rate limit exceeded for `{bucket}` "
                        f"({limit} per {self._window}s). Retry in {retry_after}s."
                    ),
                    headers={"Retry-After": str(retry_after)},
                )
            window.count += 1

    def reset(self) -> None:
        """Drop all counters (tests, and a deliberate operator reset)."""
        with self._lock:
            self._windows.clear()


limiter = RateLimiter()

_BUCKET_LIMITS = {
    "read": ("REJOX_RATE_READ", DEFAULT_READ_LIMIT),
    "upload": ("REJOX_RATE_UPLOAD", DEFAULT_UPLOAD_LIMIT),
    "pipeline": ("REJOX_RATE_PIPELINE", DEFAULT_PIPELINE_LIMIT),
    "migrate": ("REJOX_RATE_MIGRATE", DEFAULT_MIGRATE_LIMIT),
}


def guard(request: Request, bucket: str) -> str:
    """Authenticate, then charge one request against ``bucket``'s budget."""
    identity = identify(request)
    env_name, default = _BUCKET_LIMITS[bucket]
    limiter.check(bucket, identity, _env_int(env_name, default))
    return identity


def max_concurrent_migrations() -> int:
    return _env_int(
        "REJOX_MAX_CONCURRENT_MIGRATIONS", DEFAULT_MAX_CONCURRENT_MIGRATIONS
    )
