"""API authentication and rate limiting.

The pipeline is expensive in ways an anonymous caller should never be able to
spend freely: `/api/migrate` installs a dependency tree, type-checks and bundles
a project, and the AI Resolution Engine spends a metered Gemini quota. So the
HTTP surface has two gates, both deliberately simple:

**Identity** — established from one of two sources, because the two clients of
this API cannot use the same credential:

``key:<digest>``
    A shared API key, sent as ``Authorization: Bearer <key>`` or ``X-API-Key``,
    from ``REJOX_API_KEYS``. The credential for a CLI, CI job or script.

``acct:<digest>``
    A browser session cookie carrying an account, minted from an invite code —
    see :mod:`app.sessions`. Browsers get this because two of the surfaces they
    use (``EventSource`` and a download link) cannot send a header at all.

Both resolve to a **stable** identity string, which is what makes them
interchangeable everywhere it is used: the rate limiter counts it, and
``{run}/owner`` stores it. An account survives logging out and back in, so a run
does not change hands and a budget cannot be reset by re-authenticating.

The header is consulted first: a caller that presented a key meant to act as
that key, and a stray cookie must not silently override it.

**Budget** — a fixed-window limit per identity, stricter for the stages that
cost real money or CPU than for reads.

*Where* the counters live is a deployment decision, made in one place
(``REJOX_RATE_STORE``) the way ``app.queue`` decides where a migration runs:

``memory`` (default — CLI, tests, a single-container deployment)
    Counters in this process. Simple and dependency-free, and honest about its
    limit: behind N API replicas the effective ceiling is N times the configured
    one, because each replica counts only its own share.

``redis`` (production, and required for more than one API replica)
    Counters in Redis (``REJOX_REDIS_URL`` — the same instance the queue uses),
    so the limit is a limit for the fleet rather than per container.

Refusing by default is the point: with no keys configured the protected
endpoints return 503 explaining what to set, rather than quietly serving
everyone. ``REJOX_ALLOW_ANONYMOUS=1`` opts a developer machine out. The same
rule governs the store: if the shared store cannot be reached, the endpoint
answers 503 — it does NOT fall back to counting in this process, which would
silently restore the per-replica ceiling exactly when nobody is watching.
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

from app import sessions

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

# Where the counters live. `memory` is the honest default for one container;
# more than one API replica needs `redis` or the ceiling multiplies silently.
DEFAULT_RATE_STORE = "memory"
# Redis connect/read ceiling, mirroring app.queue: this is a local-network hop,
# and a slow answer must surface as a 503 rather than a request that hangs.
DEFAULT_REDIS_TIMEOUT_SECONDS = 5


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

    ``key:<digest>`` for an API key, ``acct:<digest>`` for a browser session, or
    ``ip:<addr>`` when anonymous access is explicitly allowed.
    """
    keys = _configured_keys()
    codes = sessions.configured_codes()
    if not keys and not codes:
        if _env_flag("REJOX_ALLOW_ANONYMOUS"):
            return f"ip:{request.client.host if request.client else 'unknown'}"
        raise HTTPException(
            status_code=503,
            detail=(
                "This Rejox server has no API keys or invite codes configured, "
                "so it will not serve requests. Set REJOX_API_KEYS or "
                "REJOX_INVITE_CODES (comma-separated), or "
                "REJOX_ALLOW_ANONYMOUS=1 for a local development server."
            ),
        )

    presented = _presented_key(request)
    if presented is None:
        # No key offered: this is a browser, or nothing at all.
        account = sessions.account_from_request(request)
        if account is not None:
            return f"acct:{account}"
        raise HTTPException(
            status_code=401,
            detail=(
                "Not signed in. Send `Authorization: Bearer <key>` / `X-API-Key`, "
                "or POST an invite code to /api/session for a browser session."
            ),
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not keys:
        # Keys are not in use on this server, so a presented key cannot match
        # one. Say that rather than the misleading "Invalid API key".
        raise HTTPException(
            status_code=401,
            detail="This server accepts invite-code sessions, not API keys.",
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


class RateLimitStoreError(RuntimeError):
    """The shared counter store could not be reached.

    Never a reason to count in this process instead: that is the per-replica
    ceiling this store exists to remove, and it would come back silently.
    """


# Both stores answer the same question — "this is request N of the window, and
# the window has S seconds left" — so `check` below stays the only place that
# knows what a limit means. The window starts at the first request for a key,
# not on a wall-clock boundary, which is the semantics the in-process counter
# has always had; Redis reproduces it with a TTL set on the first hit.
class _MemoryStore:
    """Counters in this process. One API container, or a developer machine."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._windows: dict[str, _Window] = {}

    def hit(self, key: str, window_seconds: int) -> tuple[int, int]:
        now = time.monotonic()
        with self._lock:
            window = self._windows.get(key)
            if window is None or now - window.started >= window_seconds:
                self._windows[key] = _Window(started=now, count=1)
                return 1, window_seconds
            window.count += 1
            return window.count, max(1, int(window_seconds - (now - window.started)))

    def clear(self) -> None:
        with self._lock:
            self._windows.clear()


# INCR and EXPIRE as one atomic step, because a process that died between them
# would leave a counter that never expires and lock an identity out for ever.
# Returns the count and the key's remaining TTL, so the 429 can say when to come
# back without a second round trip.
_HIT_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
"""

_REDIS_KEY_PREFIX = "rejox:rate:"


class _RedisStore:
    """Counters in Redis, so N API replicas share one budget per identity."""

    def __init__(self, url: str) -> None:
        self.url = url
        self._client = None
        self._script = None
        self._lock = threading.Lock()

    def _connect(self):
        # Lazily, and cached: the client is cheap to hold and wasteful to
        # rebuild per request. Same bounded timeouts as the queue's connection —
        # an unreachable Redis must surface as a fast 503, never as a request
        # that hangs while redis-py retries.
        with self._lock:
            if self._client is None:
                try:
                    from redis import Redis  # noqa: PLC0415
                except ImportError as exc:  # pragma: no cover - packaging guard
                    raise RateLimitStoreError(
                        "REJOX_RATE_STORE=redis needs the `redis` package. "
                        "Install it, or use REJOX_RATE_STORE=memory."
                    ) from exc
                timeout = _env_int("REJOX_REDIS_TIMEOUT", DEFAULT_REDIS_TIMEOUT_SECONDS)
                client = Redis.from_url(
                    self.url,
                    socket_connect_timeout=timeout,
                    socket_timeout=timeout,
                    retry_on_timeout=False,
                )
                self._script = client.register_script(_HIT_SCRIPT)
                self._client = client
            return self._client, self._script

    def hit(self, key: str, window_seconds: int) -> tuple[int, int]:
        _client, script = self._connect()
        try:
            count, ttl = script(keys=[_REDIS_KEY_PREFIX + key], args=[window_seconds])
        except Exception as exc:  # unreachable, auth, DNS, script error…
            raise RateLimitStoreError(
                f"Rate-limit store at {self.url} is unreachable: {exc}"
            ) from exc
        # TTL is -1 for a key with no expiry and -2 for one that vanished
        # between the INCR and the TTL; neither is a usable Retry-After.
        ttl = int(ttl)
        return int(count), ttl if ttl > 0 else window_seconds

    def clear(self) -> None:
        client, _script = self._connect()
        for found in client.scan_iter(match=_REDIS_KEY_PREFIX + "*", count=500):
            client.delete(found)


def rate_store() -> str:
    """Which store holds the counters. Read per call, like ``queue.backend()``."""
    raw = os.environ.get("REJOX_RATE_STORE", DEFAULT_RATE_STORE).strip().lower()
    if raw not in ("memory", "redis"):
        raise HTTPException(
            status_code=503,
            detail=f"REJOX_RATE_STORE={raw!r} is not a store; use 'redis' or 'memory'.",
        )
    return raw


class RateLimiter:
    """Fixed-window counter, keyed by (bucket, identity), over one store."""

    def __init__(self, window_seconds: int = DEFAULT_WINDOW_SECONDS) -> None:
        self._window = window_seconds
        self._memory = _MemoryStore()
        self._redis: Optional[_RedisStore] = None
        self._lock = threading.Lock()

    def _store(self):
        if rate_store() == "memory":
            return self._memory
        # queue.redis_url() rather than a second setting: one Redis, named once.
        from app.queue import redis_url  # noqa: PLC0415 - imported late by design

        url = redis_url()
        with self._lock:
            if self._redis is None or self._redis.url != url:
                self._redis = _RedisStore(url)
            return self._redis

    def check(self, bucket: str, identity: str, limit: int) -> None:
        """Count one request; raise 429 when the identity is over budget."""
        try:
            count, retry_after = self._store().hit(f"{bucket}:{identity}", self._window)
        except RateLimitStoreError as exc:
            # Refuse rather than degrade: quietly counting in this process would
            # restore the per-replica ceiling and look exactly like working.
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if count > limit:
            retry_after = max(1, retry_after)
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Rate limit exceeded for `{bucket}` "
                    f"({limit} per {self._window}s). Retry in {retry_after}s."
                ),
                headers={"Retry-After": str(retry_after)},
            )

    def reset(self) -> None:
        """Drop all counters (tests, and a deliberate operator reset).

        Best-effort on the shared store, and only where one was already built:
        this is a convenience, not the control, and it must never be the thing
        that fails a test run or a deploy.
        """
        self._memory.clear()
        with self._lock:
            store = self._redis
        if store is not None:
            try:
                store.clear()
            except Exception:  # pragma: no cover - convenience, never fatal
                pass


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
