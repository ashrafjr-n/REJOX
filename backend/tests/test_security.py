"""Tests for the HTTP gates (``app/security.py``) and how the API applies them.

The point of these is the *refusals*: an unauthenticated caller, a caller over
budget, and a server configured with neither keys nor an explicit opt-out must
all be turned away — and a migration must not start at all on a host that
cannot contain the code it is about to run.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import security
from app.main import app

client = TestClient(app)

# The session fixture in conftest puts the process in the developer posture.
# These tests undo it per-case to exercise what a server actually does.


@pytest.fixture
def strict(monkeypatch: pytest.MonkeyPatch) -> None:
    """A server with keys configured: no anonymous access."""
    monkeypatch.delenv("REJOX_ALLOW_ANONYMOUS", raising=False)
    monkeypatch.setenv("REJOX_API_KEYS", "key-alpha,key-beta")
    security.limiter.reset()


# --- Identity ----------------------------------------------------------------


def test_unconfigured_server_refuses_rather_than_serving_everyone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("REJOX_ALLOW_ANONYMOUS", raising=False)
    monkeypatch.delenv("REJOX_API_KEYS", raising=False)
    resp = client.post("/api/parse", json={"path": "/nonexistent"})
    assert resp.status_code == 503
    assert "REJOX_API_KEYS" in resp.json()["detail"]


def test_missing_key_is_rejected(strict: None) -> None:
    resp = client.post("/api/parse", json={"path": "/nonexistent"})
    assert resp.status_code == 401
    assert resp.headers.get("www-authenticate") == "Bearer"


def test_wrong_key_is_rejected(strict: None) -> None:
    resp = client.post(
        "/api/parse",
        json={"path": "/nonexistent"},
        headers={"Authorization": "Bearer not-a-key"},
    )
    assert resp.status_code == 401


@pytest.mark.parametrize(
    "headers",
    [
        {"Authorization": "Bearer key-alpha"},
        {"X-API-Key": "key-beta"},
    ],
)
def test_a_valid_key_gets_past_the_gate(strict: None, headers: dict) -> None:
    resp = client.post("/api/parse", json={"path": "/nonexistent"}, headers=headers)
    # Past auth: the failure is now about the path, not the caller.
    assert resp.status_code not in (401, 503)


def test_health_needs_no_key(strict: None) -> None:
    # Liveness must answer for an orchestrator that holds no credentials.
    assert client.get("/health").status_code == 200


# --- Budgets -----------------------------------------------------------------


def test_identity_over_budget_is_throttled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REJOX_ALLOW_ANONYMOUS", "1")
    monkeypatch.delenv("REJOX_API_KEYS", raising=False)
    monkeypatch.setenv("REJOX_RATE_PIPELINE", "3")
    security.limiter.reset()

    codes = [
        client.post("/api/parse", json={"path": "/nonexistent"}).status_code
        for _ in range(5)
    ]
    assert codes.count(429) == 2, codes


def test_throttling_says_when_to_come_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REJOX_ALLOW_ANONYMOUS", "1")
    monkeypatch.setenv("REJOX_RATE_PIPELINE", "1")
    security.limiter.reset()

    client.post("/api/parse", json={"path": "/nonexistent"})
    resp = client.post("/api/parse", json={"path": "/nonexistent"})
    assert resp.status_code == 429
    assert int(resp.headers["retry-after"]) >= 1


def test_budgets_are_per_bucket_not_shared(monkeypatch: pytest.MonkeyPatch) -> None:
    # Exhausting the expensive bucket must not lock a caller out of reads.
    monkeypatch.setenv("REJOX_ALLOW_ANONYMOUS", "1")
    monkeypatch.setenv("REJOX_RATE_PIPELINE", "1")
    security.limiter.reset()

    client.post("/api/parse", json={"path": "/nonexistent"})
    assert client.post("/api/parse", json={"path": "/nonexistent"}).status_code == 429
    assert client.get("/api/jobs/no-such-job").status_code == 404


def test_separate_identities_have_separate_budgets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("REJOX_ALLOW_ANONYMOUS", raising=False)
    monkeypatch.setenv("REJOX_API_KEYS", "key-alpha,key-beta")
    monkeypatch.setenv("REJOX_RATE_PIPELINE", "1")
    security.limiter.reset()

    alpha = {"Authorization": "Bearer key-alpha"}
    beta = {"Authorization": "Bearer key-beta"}
    client.post("/api/parse", json={"path": "/nonexistent"}, headers=alpha)
    assert (
        client.post("/api/parse", json={"path": "/nonexistent"}, headers=alpha).status_code
        == 429
    )
    # Beta has spent nothing, so beta is not throttled by alpha's usage.
    assert (
        client.post("/api/parse", json={"path": "/nonexistent"}, headers=beta).status_code
        != 429
    )


# --- Where the counters live -------------------------------------------------
#
# The shared-store behaviour itself needs a real Redis and lives in
# `test_rate_limit_shared.py` (gate C2). What belongs here is the refusal: what
# the surface does when the store is misconfigured or gone.


def test_an_unreachable_shared_store_refuses_rather_than_counting_locally(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Falling back to per-process counters would restore the very ceiling the
    # shared store removes — and would look exactly like a working server.
    monkeypatch.setenv("REJOX_ALLOW_ANONYMOUS", "1")
    monkeypatch.setenv("REJOX_RATE_STORE", "redis")
    monkeypatch.setenv("REJOX_REDIS_URL", "redis://127.0.0.1:6399/0")  # nothing listens
    security.limiter.reset()

    resp = client.post("/api/parse", json={"path": "/nonexistent"})
    assert resp.status_code == 503
    assert "6399" in resp.json()["detail"]


def test_an_unknown_store_name_refuses_rather_than_guessing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("REJOX_ALLOW_ANONYMOUS", "1")
    monkeypatch.setenv("REJOX_RATE_STORE", "postgres")
    security.limiter.reset()

    resp = client.post("/api/parse", json={"path": "/nonexistent"})
    assert resp.status_code == 503
    assert "REJOX_RATE_STORE" in resp.json()["detail"]


# --- Migration is gated on containment ---------------------------------------


def test_migrate_refuses_on_a_host_that_cannot_contain_the_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("REJOX_ALLOW_ANONYMOUS", "1")
    monkeypatch.delenv("REJOX_ALLOW_UNSANDBOXED", raising=False)
    monkeypatch.setenv("REJOX_SANDBOX", "direct")
    security.limiter.reset()

    resp = client.post("/api/migrate", json={"path": "/nonexistent"})
    assert resp.status_code == 503
    assert "REJOX_SANDBOX=docker" in resp.json()["detail"]
