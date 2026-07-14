#!/usr/bin/env bash
#
# Rejox — one-command local dev.
# Starts the FastAPI backend (uvicorn, :8000) and the Vite frontend (:5173),
# and tears both down together on Ctrl+C.
#
#   ./dev.sh
#
# The Upload → Analyze → Report path needs NO LLM. Set GEMINI_API_KEY only if
# you want the one AI step in the full migrate flow (see README).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- backend -----------------------------------------------------------------
cd "$ROOT/backend"
if [ -d venv ]; then
  # shellcheck disable=SC1091
  source venv/bin/activate
else
  echo "!! backend/venv not found — run the install steps in README.md first." >&2
  exit 1
fi
echo ">> backend  → http://localhost:8000  (docs at /docs)"
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!

# --- frontend ----------------------------------------------------------------
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  echo "!! frontend/node_modules not found — run 'npm install' first." >&2
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 1
fi
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
echo "   Open http://localhost:5173 in your browser. Ctrl+C stops both."
echo ""

wait
