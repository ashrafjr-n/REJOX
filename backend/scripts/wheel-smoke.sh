#!/usr/bin/env bash
# The package gate: build the wheel, install it into a clean venv (never -e),
# and migrate the benchmark end to end with nothing from the checkout on the
# path. The only check that proves what a user installs actually works.
#
#   backend/scripts/wheel-smoke.sh [python]      # default: python3
#
# Passes only when tsc and Metro both PASS on the emitted project. The venv's
# site-packages is made read-only first, so any write into the install dir fails
# the run instead of going unnoticed.
set -euo pipefail

BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
SAMPLE="$BACKEND/../test-projects/sample-app"
PYTHON="${1:-python3}"
WORK="$(mktemp -d)"
trap 'chmod -R u+w "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT

echo "==> build"
uv build --wheel --out-dir "$WORK/dist" "$BACKEND" >/dev/null
WHEEL="$(ls "$WORK"/dist/rejox-*.whl)"
echo "    $(basename "$WHEEL") ($(du -h "$WHEEL" | cut -f1))"

echo "==> install into a clean venv ($("$PYTHON" --version))"
"$PYTHON" -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q "$WHEEL"
SITE="$("$WORK/venv/bin/python" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
chmod -R a-w "$SITE"

echo "==> rejox migrate sample-app (from $WORK, not the checkout)"
cd "$WORK"
export XDG_CACHE_HOME="$WORK/cache"
export PYTHONDONTWRITEBYTECODE=1
unset REJOX_WORKSPACE_ROOT REJOX_AI_CACHE GEMINI_API_KEY REJOX_AI_PROVIDER
"$WORK/venv/bin/rejox" migrate "$SAMPLE" --yes --out "$WORK/out" 2>&1 | tee "$WORK/migrate.log"

# ponytail: grep on the rendered table until `migrate` exits non-zero on a
# failed validation (packaging plan, phase 2); then this is just the exit code.
grep -Eq 'Typecheck \(tsc\) +PASS' "$WORK/migrate.log" || { echo "FAIL: tsc did not pass"; exit 1; }
grep -Eq 'Bundle \(Metro\) +PASS' "$WORK/migrate.log" || { echo "FAIL: Metro did not pass"; exit 1; }
echo "==> PASS: the installed wheel migrated sample-app (tsc + Metro)"
