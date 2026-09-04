#!/usr/bin/env bash
#
# Rejox — one-command local dev, WITH the browser sign-in flow.
#
#   ./dev-local.sh
#
# dev.sh runs anonymous on purpose: it is the fast path and never exercises
# sign-in. This script is the other half — everything dev.sh sets, plus the
# three variables a session actually needs, so the login screen works:
#
#   REJOX_INVITE_CODES    the codes the login screen accepts. Unset, the server
#                         has no valid code at all and rejects everything.
#   REJOX_SESSION_SECRET  signs the session cookie. Unset, /api/session 503s —
#                         there is deliberately no baked-in default, because a
#                         shared fallback key would let anyone mint a session
#                         for any Rejox server.
#   REJOX_COOKIE_INSECURE the cookie is Secure by default, so a browser will not
#                         send it back over plain http. Refused unless
#                         REJOX_ALLOW_ANONYMOUS=1 is also set (it is, below).
#
# Local only. It binds to 127.0.0.1 and migrates projects you chose yourself.
# Never use this posture for anything reachable from outside this machine —
# see docs/SECURITY.md.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The invite code you type on the login screen. Fixed so it never changes
# between runs. Override with: INVITE_CODE=something ./dev-local.sh
INVITE_CODE="${INVITE_CODE:-my-code-2026}"

# --- session signing secret --------------------------------------------------
# Generated once and kept, so a restart does not sign you out. It lives in a
# gitignored file (.gitignore already covers .env.*) rather than in this script,
# so a real secret is never committed.
SECRET_FILE="$ROOT/backend/.env.dev-local"
if [ ! -f "$SECRET_FILE" ]; then
  echo ">> generating a local session secret → backend/.env.dev-local"
  printf 'REJOX_SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
fi
# shellcheck disable=SC1090
set -a; source "$SECRET_FILE"; set +a

# --- backend -----------------------------------------------------------------
cd "$ROOT/backend"
if [ -d venv ]; then
  # shellcheck disable=SC1091
  source venv/bin/activate
else
  echo "!! backend/venv not found — run the install steps in README.md first." >&2
  exit 1
fi

# The three dev.sh already sets: no API key, no containment, local paths allowed.
export REJOX_ALLOW_ANONYMOUS=1
export REJOX_ALLOW_UNSANDBOXED=1
export REJOX_ALLOW_LOCAL_PATH=1

# The three that make the sign-in flow reachable.
export REJOX_INVITE_CODES="$INVITE_CODE"
export REJOX_COOKIE_INSECURE=1
# REJOX_SESSION_SECRET comes from the file sourced above.

echo ">> backend  → http://localhost:8000  (docs at /docs)"
echo "   (dev posture: no API key, no sandbox — local only)"
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!

# --- frontend ----------------------------------------------------------------
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  echo "!! frontend/node_modules not found — run 'npm install' first." >&2
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 1
fi

# Force the app to talk to the API on its OWN origin, through the Vite proxy.
# The session cookie is SameSite=Lax, so a cross-origin VITE_API_URL (which is
# exactly what .env.example sets) means the browser never sends it and sign-in
# silently never sticks. A shell variable outrules frontend/.env, so this holds
# whatever that file happens to say.
export VITE_API_URL=

echo ">> frontend → http://localhost:5173"
npm run dev -- --port 5173 &
FRONTEND_PID=$!

cleanup() {
  echo ""
  echo ">> shutting down…"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo ""
echo "   Open http://localhost:5173 — sign in with code:  $INVITE_CODE"
echo "   Ctrl+C stops both."
echo ""

wait
