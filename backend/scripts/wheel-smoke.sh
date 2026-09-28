#!/usr/bin/env bash
# The package gate: build the wheel, install it into a clean venv (never -e),
# and migrate the benchmark end to end with nothing from the checkout on the
# path. The only check that proves what a user installs actually works.
#
#   backend/scripts/wheel-smoke.sh [python]      # default: python3
#
# Set WHEEL_PATH to smoke an already-built wheel instead of building a new
# one — release.yml uses this so the gate proves the exact artifact that gets
# published, not a separate rebuild of it.
#
# Passes only when `rejox migrate` exits 0: tsc and Metro both PASS on the
# emitted project. The venv's site-packages is made read-only first, so any
# write into the install dir fails the run instead of going unnoticed.
set -euo pipefail

BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
SAMPLE="$BACKEND/../test-projects/sample-app"
PYTHON="${1:-python3}"
WORK="$(mktemp -d)"
trap 'chmod -R u+w "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT

if [ -n "${WHEEL_PATH:-}" ]; then
  echo "==> using prebuilt wheel"
  WHEEL="$WHEEL_PATH"
else
  echo "==> build"
  uv build --wheel --out-dir "$WORK/dist" "$BACKEND" >/dev/null
  WHEEL="$(ls "$WORK"/dist/rejox-*.whl)"
fi
echo "    $(basename "$WHEEL") ($(du -h "$WHEEL" | cut -f1))"
# backend/LICENSE is a copy of the repo's (pyproject cannot reach outside
# backend/); a missing or drifted copy fails here rather than shipping.
unzip -p "$WHEEL" '*.dist-info/licenses/LICENSE' | cmp -s - "$BACKEND/../LICENSE" \
  || { echo "FAIL: the wheel's LICENSE is missing or differs from the repo's"; exit 1; }
for f in parser.js codemod.js THIRD_PARTY_LICENSES.txt; do
  unzip -l "$WHEEL" "rejox/_workers/$f" >/dev/null || { echo "FAIL: the wheel has no rejox/_workers/$f"; exit 1; }
done

echo "==> install into a clean venv ($("$PYTHON" --version))"
"$PYTHON" -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q "$WHEEL"
# The CLI alone must never pull in the server's extras (fastapi, redis, rq).
if "$WORK/venv/bin/pip" list --format=freeze | grep -iqE '^(fastapi|redis|rq|uvicorn)=='; then
  echo "FAIL: the bare CLI install pulled in a server-only dependency"
  exit 1
fi
SITE="$("$WORK/venv/bin/python" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
chmod -R a-w "$SITE"

echo "==> rejox migrate sample-app (from $WORK, not the checkout)"
cd "$WORK"
export XDG_CACHE_HOME="$WORK/cache"
export PYTHONDONTWRITEBYTECODE=1
unset REJOX_WORKSPACE_ROOT REJOX_AI_CACHE GEMINI_API_KEY REJOX_AI_PROVIDER
"$WORK/venv/bin/rejox" doctor
# Exit 0 means tsc and Metro both passed (1 = validation failed; see --help).
"$WORK/venv/bin/rejox" migrate "$SAMPLE" --no-input --out "$WORK/out" \
  || { echo "FAIL: rejox migrate exited $?"; exit 1; }
echo "==> PASS: the installed wheel migrated sample-app (tsc + Metro)"

# sample-app holds no class the rules miss, so the run above never reaches the
# LLM tier. This one does — with no key, which is how most people run Rejox:
# the classes must stay residue (exit 0), never crash the run (exit 70).
echo "==> rejox migrate residue-app with AI disabled"
"$WORK/venv/bin/rejox" migrate "$BACKEND/tests/fixtures/residue-app" --no-input --no-validate \
  --out "$WORK/residue-out" \
  || { echo "FAIL: rejox migrate exited $? on residue-app with no key"; exit 1; }
grep -q "REJOX-TODO(TW_UNSUPPORTED)" "$WORK/residue-out/src/App.tsx" \
  || { echo "FAIL: residue-app lost its TW_UNSUPPORTED TODO"; exit 1; }
grep -q "REJOX-TODO(TW_STRUCTURAL)" "$WORK/residue-out/src/App.tsx" \
  || { echo "FAIL: residue-app lost its TW_STRUCTURAL TODO"; exit 1; }
echo "==> PASS: the zero-AI path keeps unmapped classes as residue"
