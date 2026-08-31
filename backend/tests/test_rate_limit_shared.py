"""Gate C2 — the rate limit is shared across API replicas, against a live Redis.

`test_security.py` proves what a limit means; it cannot prove *where* the count
lives, and that is the whole of C2. With counters in each API process, N
replicas means N times the configured ceiling — a limit that quietly is not one.

Two independent :class:`RateLimiter` objects stand in for two API replicas here:
separate instances hold separate memory, exactly as separate processes do, so a
budget they share can only be shared through Redis. The negative control below
runs the identical scenario on the memory store and asserts it does NOT hold,
which is what makes the positive result mean something — and what would catch a
silent fallback to per-process counting.

Skipped automatically wherever no Redis answers. Marked `redis_live` so it can
be deselected by name rather than by accident.
"""

from __future__ import annotations

import time
import uuid

import pytest

from app import security

pytestmark = pytest.mark.redis_live

TEST_REDIS_URL = "redis://localhost:6379/0"


def _redis_is_up() -> bool:
    try:
        from redis import Redis
    except ImportError:
        return False
    try:
        client = Redis.from_url(
            TEST_REDIS_URL, socket_connect_timeout=2, socket_timeout=2
        )
        return bool(client.ping())
    except Exception:
        return False


@pytest.fixture(scope="module", autouse=True)
def _requires_redis() -> None:
    if not _redis_is_up():
        pytest.skip(f"no Redis at {TEST_REDIS_URL} — this gate asserts against a live one")


@pytest.fixture
def shared(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REJOX_RATE_STORE", "redis")
    monkeypatch.setenv("REJOX_REDIS_URL", TEST_REDIS_URL)


@pytest.fixture
def local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REJOX_RATE_STORE", "memory")


def _identity() -> str:
    # A fresh identity per test, so one test's spent budget is never another's
    # starting condition — the counters outlive the process by design.
    return f"key:{uuid.uuid4().hex[:16]}"


def _spend(replicas: list[security.RateLimiter], identity: str, limit: int, n: int) -> int:
    """Send ``n`` requests round-robin across the replicas; count the allowed."""
    allowed = 0
    for i in range(n):
        try:
            replicas[i % len(replicas)].check("upload", identity, limit)
            allowed += 1
        except Exception as exc:  # HTTPException(429) — anything else is a bug
            assert getattr(exc, "status_code", None) == 429, exc
    return allowed


def test_two_replicas_share_one_budget(shared: None) -> None:
    limit, identity = 10, _identity()
    two = [security.RateLimiter(), security.RateLimiter()]

    allowed = _spend(two, identity, limit, 40)

    # The gate: exactly the configured ceiling, regardless of replica count.
    assert allowed == limit


def test_the_same_scenario_on_memory_counters_multiplies_the_ceiling(local: None) -> None:
    # The negative control. This is the bug C2 exists to catch, asserted rather
    # than described — if the redis store ever silently falls back to counting
    # in-process, the test above starts producing this number instead.
    limit, identity = 10, _identity()
    two = [security.RateLimiter(), security.RateLimiter()]

    allowed = _spend(two, identity, limit, 40)

    assert allowed == limit * 2


def test_a_replica_that_joins_late_inherits_the_spent_budget(shared: None) -> None:
    # A replica started mid-window (a deploy, an autoscale) must not hand out a
    # fresh allowance to an identity that has already spent one.
    limit, identity = 5, _identity()
    first = security.RateLimiter()
    assert _spend([first], identity, limit, limit) == limit

    late = security.RateLimiter()
    assert _spend([late], identity, limit, 5) == 0


def test_budgets_stay_separate_per_identity_and_per_bucket(shared: None) -> None:
    limit = 3
    alpha, bravo = _identity(), _identity()
    one = security.RateLimiter()

    assert _spend([one], alpha, limit, limit) == limit
    # Another identity is untouched by alpha's spending…
    assert _spend([one], bravo, limit, limit) == limit
    # …and so is another bucket for alpha, which must not be locked out of reads
    # by exhausting the expensive bucket.
    one.check("read", alpha, limit)


def test_the_window_expires_on_the_shared_store(shared: None) -> None:
    limit, identity = 2, _identity()
    one = security.RateLimiter(window_seconds=1)

    assert _spend([one], identity, limit, 4) == limit
    time.sleep(1.2)
    assert _spend([one], identity, limit, 1) == 1


def test_the_429_says_when_to_come_back(shared: None) -> None:
    identity = _identity()
    one = security.RateLimiter()
    one.check("upload", identity, 1)

    with pytest.raises(Exception) as caught:
        one.check("upload", identity, 1)
    exc = caught.value
    assert getattr(exc, "status_code", None) == 429
    # Read from the shared key's TTL, so every replica answers the same thing.
    retry_after = int(exc.headers["Retry-After"])  # type: ignore[attr-defined]
    assert 1 <= retry_after <= security.DEFAULT_WINDOW_SECONDS
