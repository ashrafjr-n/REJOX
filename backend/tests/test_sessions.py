"""Invite code -> signed session cookie, and the identity it establishes.

The property these guard is not "a cookie works". It is that the cookie carries
an ACCOUNT: a run's owner and a rate-limit bucket must survive signing out and
back in, or ownership silently changes hands and a budget can be reset by
re-authenticating.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app import sessions
from app.main import app

CODE = "invite-alpha"
OTHER = "invite-bravo"


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("REJOX_WORKSPACE_ROOT", str(tmp_path / "workspaces"))
    monkeypatch.setenv("REJOX_INVITE_CODES", f"{CODE},{OTHER}")
    monkeypatch.setenv("REJOX_SESSION_SECRET", "test-secret-not-a-real-one")
    monkeypatch.delenv("REJOX_API_KEYS", raising=False)
    monkeypatch.delenv("REJOX_ALLOW_ANONYMOUS", raising=False)
    monkeypatch.setenv("REJOX_COOKIE_INSECURE", "")
    return tmp_path


@pytest.fixture
def client(env):
    # https, so the Secure cookie is actually exchanged: these tests assert the
    # production configuration rather than a relaxed one built to make them pass.
    return TestClient(app, base_url="https://testserver")


def test_a_valid_code_returns_an_httponly_cookie(client) -> None:
    resp = client.post("/api/session", json={"code": CODE})
    assert resp.status_code == 200, resp.text
    assert resp.json()["signedIn"] is True

    raw = resp.headers["set-cookie"]
    assert "HttpOnly" in raw          # JS must not be able to read it
    assert "Secure" in raw            # not sent over plain http by default
    assert "SameSite=lax" in raw.replace("Lax", "lax")


def test_the_cookie_never_carries_the_code(client) -> None:
    """The code is the credential; the cookie carries a digest of it."""
    resp = client.post("/api/session", json={"code": CODE})
    assert CODE not in resp.headers["set-cookie"]
    assert CODE not in resp.text


def test_a_wrong_code_is_refused(client) -> None:
    resp = client.post("/api/session", json={"code": "not-a-code"})
    assert resp.status_code == 401
    assert "set-cookie" not in resp.headers


def test_the_account_survives_signing_out_and_back_in(client) -> None:
    """THE point of accounts. A session is transport; the account is identity.
    If this ever fails, every run a user owns is orphaned by a logout."""
    first = client.post("/api/session", json={"code": CODE}).json()["account"]
    client.delete("/api/session")
    assert client.get("/api/session").json()["signedIn"] is False
    second = client.post("/api/session", json={"code": CODE}).json()["account"]
    assert first == second


def test_two_codes_are_two_accounts(client) -> None:
    a = client.post("/api/session", json={"code": CODE}).json()["account"]
    b = client.post("/api/session", json={"code": OTHER}).json()["account"]
    assert a != b


def test_a_session_authenticates_a_guarded_route(client) -> None:
    assert client.get("/api/jobs/deadbeef").status_code == 401
    client.post("/api/session", json={"code": CODE})
    # Now authenticated: a missing job is 404, not 401.
    assert client.get("/api/jobs/deadbeef").status_code == 404


def test_revoking_the_code_kills_the_session(client, monkeypatch) -> None:
    """Account revocation without a session store: the signature stays valid,
    but the account it names is gone, so the request is not."""
    client.post("/api/session", json={"code": CODE})
    assert client.get("/api/jobs/deadbeef").status_code == 404
    monkeypatch.setenv("REJOX_INVITE_CODES", OTHER)
    assert client.get("/api/session").json()["signedIn"] is False
    assert client.get("/api/jobs/deadbeef").status_code == 401


def test_a_tampered_cookie_is_not_believed(env) -> None:
    good = sessions.issue(sessions.account_id(CODE))
    payload, sig = good.split(".", 1)
    assert sessions.read(good) == sessions.account_id(CODE)
    assert sessions.read(f"{payload}.{sig[:-2]}xx") is None
    # A forged payload with someone else's account, signed with nothing valid.
    assert sessions.read(f"{payload}x.{sig}") is None


def test_an_expired_cookie_is_not_believed(env, monkeypatch) -> None:
    monkeypatch.setenv("REJOX_SESSION_TTL", "1")
    value = sessions.issue(sessions.account_id(CODE), now=time.time() - 10)
    assert sessions.read(value) is None


def test_a_key_beats_a_cookie(env, monkeypatch) -> None:
    """A caller that presented a key meant to act as that key. A stray cookie
    from a browser profile must not silently substitute a different identity."""
    monkeypatch.setenv("REJOX_API_KEYS", "key-one")
    client = TestClient(app, base_url="https://testserver")
    client.post("/api/session", json={"code": CODE})
    resp = client.get("/api/jobs/deadbeef", headers={"X-API-Key": "key-one"})
    assert resp.status_code == 404  # authenticated as the key, not the cookie

    # And a bad key is rejected outright rather than falling through to it.
    assert client.get("/api/jobs/deadbeef", headers={"X-API-Key": "wrong"}).status_code == 401


def test_no_signing_secret_is_a_loud_refusal(env, monkeypatch) -> None:
    """A default signing key would mean every deployment that forgot to set one
    shared it — and anyone could mint a session for any Rejox server."""
    monkeypatch.delenv("REJOX_SESSION_SECRET", raising=False)
    client = TestClient(app, base_url="https://testserver")
    resp = client.post("/api/session", json={"code": CODE})
    assert resp.status_code == 503
    assert "REJOX_SESSION_SECRET" in resp.json()["detail"]
