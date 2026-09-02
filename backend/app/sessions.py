"""Browser sessions — an invite code exchanged for a signed cookie.

An API key is the right credential for a CLI and the wrong one for a browser.
Two of this product's surfaces cannot carry a header at all:

    new EventSource(jobEventsUrl(...))    # EventSource takes no headers
    <a href={downloadUrl(runId)}>         # a download link takes no headers

so a header-only scheme cannot authenticate the migration event stream or the
download of the emitted project. A cookie is not the nicer option here; it is
the only one that reaches those two.

**The identity a session carries is the ACCOUNT, never the session.** A run's
owner is written to ``{run}/owner`` and compared verbatim, and the rate limiter
counts per identity — so if a session were the identity, logging out and back in
would orphan every run the user owned and hand them a fresh rate-limit budget.
The cookie is a means of transport for an account id derived from the invite
code; the account outlives any number of sessions.

**No session store.** The cookie is signed (HMAC-SHA256) and carries the account
and its expiry; nothing is kept server-side. The revocation that matters is
revoking an *account*, and that comes free: every request re-checks that the
account is still one of the configured codes, so removing a code from
``REJOX_INVITE_CODES`` kills its sessions on the next request. What this does
not offer is revoking one session while leaving that account's others alive —
a trade taken deliberately rather than adding a second Redis-backed seam.

Codes live in ``REJOX_INVITE_CODES`` (comma-separated), mirroring
``REJOX_API_KEYS`` exactly, so an operator learns one convention.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional

from fastapi import HTTPException, Request, Response

COOKIE_NAME = "rejox_session"
# A working session that outlives a working day without becoming a permanent
# credential sitting in a browser profile.
DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60


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


def ttl_seconds() -> int:
    return _env_int("REJOX_SESSION_TTL", DEFAULT_SESSION_TTL_SECONDS)


def configured_codes() -> list[str]:
    raw = os.environ.get("REJOX_INVITE_CODES", "")
    return [c.strip() for c in raw.split(",") if c.strip()]


def account_id(code: str) -> str:
    """The stable account an invite code names.

    A digest, not the code: this value is written into ``{run}/owner``, counted
    by the rate limiter and printed in logs, and none of those should ever hold
    the credential itself.
    """
    return hashlib.sha256(code.encode("utf-8")).hexdigest()[:16]


def known_account(account: str) -> bool:
    """Whether this account still corresponds to a configured invite code.

    Checked on every request, which is what makes account revocation immediate
    without a session store: drop the code, and the next request from any of its
    sessions fails here.
    """
    return any(
        hmac.compare_digest(account, account_id(code)) for code in configured_codes()
    )


class SigningKeyMissing(RuntimeError):
    """No signing secret configured — sessions cannot be issued or trusted."""


def _signing_key() -> bytes:
    """The cookie signing secret.

    Deliberately has no default. A baked-in fallback would mean every deployment
    that forgot to set one shared a signing key with every other, and anyone
    could mint a session for any Rejox server. Missing is an error, loudly.
    """
    raw = os.environ.get("REJOX_SESSION_SECRET", "").strip()
    if not raw:
        raise SigningKeyMissing(
            "REJOX_SESSION_SECRET is not set, so browser sessions cannot be "
            "signed. Set it to a long random string (openssl rand -hex 32), or "
            "leave REJOX_INVITE_CODES empty to run an API-key-only server."
        )
    return raw.encode("utf-8")


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: bytes) -> str:
    return _b64(hmac.new(_signing_key(), payload, hashlib.sha256).digest())


def issue(account: str, *, now: Optional[float] = None) -> str:
    """Mint a signed cookie value for an account."""
    now = time.time() if now is None else now
    payload = json.dumps(
        {"acct": account, "iat": int(now), "exp": int(now) + ttl_seconds()},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"{_b64(payload)}.{_sign(payload)}"


def read(value: str, *, now: Optional[float] = None) -> Optional[str]:
    """The account a cookie names, or ``None`` if it is not currently valid.

    Returns None — never raises — for every rejection, and never says which:
    a bad signature, a stale expiry and a revoked account are all just "not
    signed in" to the caller. Order matters: the signature is checked before
    anything in the payload is believed.
    """
    now = time.time() if now is None else now
    try:
        encoded, signature = value.split(".", 1)
        payload = _unb64(encoded)
        if not hmac.compare_digest(signature, _sign(payload)):
            return None
        claims = json.loads(payload)
        account = claims["acct"]
        if not isinstance(account, str) or float(claims["exp"]) <= now:
            return None
    except (SigningKeyMissing, ValueError, KeyError, TypeError):
        return None
    # Revocation: the signature can be perfect and the account still gone.
    return account if known_account(account) else None


def account_from_request(request: Request) -> Optional[str]:
    cookie = request.cookies.get(COOKIE_NAME)
    return read(cookie) if cookie else None


def cookie_secure() -> bool:
    """Whether the cookie is marked ``Secure`` (HTTPS only).

    On by default. `REJOX_COOKIE_INSECURE=1` turns it off for a developer
    machine on plain http — and is refused unless that machine is also running
    with anonymous access enabled, so the flag cannot be set on a server that is
    otherwise configured for real use.
    """
    if not _env_flag("REJOX_COOKIE_INSECURE"):
        return True
    if not _env_flag("REJOX_ALLOW_ANONYMOUS"):
        raise HTTPException(
            status_code=503,
            detail=(
                "REJOX_COOKIE_INSECURE=1 sends session cookies over plain HTTP. "
                "It is refused on a server that is not also running with "
                "REJOX_ALLOW_ANONYMOUS=1, because outside local development it "
                "hands every session to anyone on the network."
            ),
        )
    return False


def attach(response: Response, account: str) -> None:
    """Set the session cookie on a response.

    ``SameSite=Lax`` is viable because the browser app and the API are served
    from ONE origin (a proxy in front of both) — see docs/SECURITY.md. That is
    what keeps CSRF off this surface without a token: a cross-site POST does not
    carry a Lax cookie, and every state-changing route here is a POST.
    """
    response.set_cookie(
        COOKIE_NAME,
        issue(account),
        max_age=ttl_seconds(),
        httponly=True,
        secure=cookie_secure(),
        samesite="lax",
        path="/",
    )


def clear(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="lax")
