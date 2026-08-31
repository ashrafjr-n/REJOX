# Pre-launch checklist

Rejox accepts a codebase from a stranger and then runs that codebase's
toolchain. Every claim this repository makes about containing that is currently
a claim about *code*, not about a *run*. This document is the list of things
that must be observed working — on a real host, against a real daemon — before
Rejox is pointed at projects nobody in this repository wrote.

It exists because of one failure mode: a system that is correct in review and
broken in production, where nobody noticed because nobody ever ran it.

## The rule

> **A gate is signed only after someone ran the command and pasted the output
> it actually produced. Reading the code is not evidence. A passing unit test
> is not evidence for a gate that says "against a live daemon".**

Every gate below has four parts:

| Part | Meaning |
| --- | --- |
| **Proves** | the one property that fails if this gate is skipped |
| **Command** | exactly what to run — copy-pasteable, no improvisation |
| **Required output** | the concrete thing that must appear: a number, a string, an exit code. Not "it works." |
| **Evidence** | filled in at signing: date, who, and the real output |

An unsigned gate is red. A gate whose output *nearly* matched is red. There is
no amber.

### How to sign

Append to the gate's Evidence block:

```text
Signed: 2026-09-01 — <name> — commit <sha>
$ <the command>
<the output, verbatim, trimmed only where it is genuinely repetitive>
```

If the output did not match, do not sign — record it under the gate as a
finding and open the fix instead. A gate that has failed once keeps that record
after it is later signed; a green checklist with no history is not credible.

### Re-signing triggers

Gates go red again when the thing they test changes. Treat these as automatic:

| Change to | Invalidates |
| --- | --- |
| `backend/app/pipeline/sandbox.py` | all of **A** |
| `backend/app/pipeline/validator.py` | A1, A4, B3 |
| `backend/app/pipeline/scaffold.py` | A8, A9 |
| `backend/app/queue.py`, `backend/app/jobs.py` | all of **B** |
| `backend/app/security.py` | all of **C** |
| `docker-compose.yml`, `backend/Dockerfile` | A0, A1, all of **B** |

Section **D** exists so that these re-runs are not a matter of anyone
remembering.

---

## Status at a glance

Nothing here is signed. That is the honest starting position, not an oversight.

| Gate | Proves | Status |
| --- | --- | --- |
| A0 | the worker can reach a Docker daemon at all | ☐ not run |
| A1 | a sandboxed command runs, in the right directory | ☐ not run — expected **red** until the bind-mount fix lands |
| A2 | the container is non-root and holds no capabilities | ☐ not run |
| A3 | only the run directory is writable | ☐ not run |
| A4 | network is off for stages that did not ask for it | ☐ not run |
| A5 | the pid ceiling stops a fork storm | ☐ not run |
| A6 | the memory ceiling is real, and the host survives it | ☐ not run |
| A7 | a missing daemon fails loudly instead of degrading | ☐ not run |
| A8 | the uploaded project's npm scripts never reach the output | ☐ not run |
| A9 | a non-registry dependency spec never reaches `npm install` | ☐ not run |
| B0 | all three services come up and stay up | ☐ not run |
| B1 | the worker is registered with Redis and takes jobs | ☐ not run |
| B2 | a full migration completes through the queue | ☐ not run |
| B3 | the emitted project is downloadable and real | ☐ not run |
| B4 | an API restart does not lose an in-flight job | ☐ not run |
| B5 | Redis down answers 503 — fast, and never in-process | ☐ not run |
| B6 | a killed worker does not silently strand a job | ☐ not run |
| B7 | retention actually deletes a run workspace | ☐ not run |
| C0 | a server with no keys refuses to serve | ☐ not run |
| C1 | a wrong key is rejected | ☐ not run |
| C2 | the rate limit is shared across API replicas | ☐ blocked — needs the Redis limiter (plan step 6) |
| C3 | a run belongs to one identity and no other | ☐ blocked — needs run ownership (plan step 7) |
| C4 | CORS is never a wildcard | ☐ not run |
| C5 | an oversized body is refused before it costs anything | ☐ not run |
| D0 | docker mode is exercised in CI, not just on someone's laptop | ☐ not run |
| D1 | the compose deployment is exercised in CI | ☐ not run |
| E0 | a failed migration is diagnosable after the fact | ☐ not run |
| E1 | one identity cannot fill the disk | ☐ not run |
| E2 | one upload cannot spend an unbounded amount of LLM quota | ☐ not run |

---

## Section A — Containment

**What this section is worth:** everything. If A fails, Rejox is a remote code
execution endpoint with a nice report attached.

These gates run against the deployed worker, through
`app.pipeline.sandbox.run()` — the real seam, not a hand-written `docker run`.
Testing a reimplementation of the flags proves the flags, not the product.

### Setup — the probe helper

Run once per session, on the host, from the repo root:

```bash
sbx() {  # sbx <net|nonet> <argv...> — one command through the real sandbox seam
  docker compose exec -T worker python - "$@" <<'PY'
import sys
from pathlib import Path
from app.pipeline.sandbox import run, SandboxPolicy

cwd = Path("/data/workspaces/probe")
cwd.mkdir(parents=True, exist_ok=True)
proc = run(sys.argv[2:], cwd, 60, network=(sys.argv[1] == "net"),
           policy=SandboxPolicy.from_env())
print("exit:", proc.returncode)
print("--- stdout ---"); print(proc.stdout)
print("--- stderr ---"); print(proc.stderr)
PY
}
```

If this helper raises `SandboxError`, that is A0 or A1 failing — record it there
rather than editing the helper until it stops complaining.

---

### A0 — the worker can reach a Docker daemon

**Proves:** the socket mount (or the nested daemon) is wired at all. Every other
gate in this section is meaningless if this one is red.

**Command:**

```bash
docker compose exec -T worker sh -c 'docker version --format "{{.Server.Version}}"'
```

**Required output:** a version string (e.g. `27.3.1`) on stdout, exit code `0`.
Not `Cannot connect to the Docker daemon`, not `docker: not found`.

**Evidence:**

```text
(unsigned)
```

---

### A1 — a sandboxed command runs, in the right directory

**Proves:** the run directory the worker passes to `docker run -v` resolves to
the same bytes inside the sandbox container. This is the gate that catches the
sibling-container path mismatch: the worker is itself a container talking to the
host's daemon, so `/data/workspaces/<run>` is a path the *worker* has and the
*host* may not. A named volume guarantees they differ.

**Command:**

```bash
docker compose exec -T worker sh -c 'echo canary-a1 > /data/workspaces/probe/canary.txt'
sbx nonet cat canary.txt
```

**Required output:** `exit: 0` and stdout containing exactly `canary-a1`.

An empty stdout with `exit: 0` is a **failure**, not a pass — it means the
sandbox mounted a different, empty directory of the same name and every
validation result computed against it is fiction. This is the single most
dangerous way this system can be wrong, because it looks green.

**Evidence:**

```text
(unsigned)
```

---

### A2 — non-root, and no capabilities

**Proves:** `--user`, `--cap-drop ALL` and `--security-opt no-new-privileges`
are in effect on the running container, not just in the argv.

**Command:**

```bash
sbx nonet id
sbx nonet sh -c 'grep -E "^(CapEff|NoNewPrivs)" /proc/self/status'
```

**Required output:**

- `id` prints `uid=<n>` where `<n>` is **not** `0`.
- `CapEff:` is `0000000000000000`.
- `NoNewPrivs:` is `1`.

**Evidence:**

```text
(unsigned)
```

---

### A3 — only the run directory is writable

**Proves:** `--read-only` plus a single writable mount. A sandbox that can write
to the image is a sandbox that can persist between stages.

**Command:**

```bash
sbx nonet sh -c 'touch /etc/probe-a3; echo "etc-write-rc=$?"'
sbx nonet sh -c 'touch /work/probe-a3;  echo "work-write-rc=$?"'
sbx nonet sh -c 'touch /tmp/probe-a3;   echo "tmp-write-rc=$?"'
```

**Required output:**

- `etc-write-rc=1`, with `Read-only file system` in stderr.
- `work-write-rc=0` — the run directory must stay usable.
- `tmp-write-rc=0` — `/tmp` is a `noexec` tmpfs by design.

**Evidence:**

```text
(unsigned)
```

---

### A4 — network is off unless the stage asked for it

**Proves:** `--network none` for typecheck and bundle. A sandbox with a network
can exfiltrate the run, and can fetch a second stage of whatever it is running.

**Command:**

```bash
sbx nonet node -e 'require("dns").lookup("registry.npmjs.org", e => console.log(e ? "BLOCKED" : "REACHED"))'
sbx net   node -e 'require("dns").lookup("registry.npmjs.org", e => console.log(e ? "BLOCKED" : "REACHED"))'
```

**Required output:** `BLOCKED` for the first, `REACHED` for the second. Both
matter — the second proves the install stage still works, so nobody "fixes" a
red first line by turning the network on everywhere.

**Evidence:**

```text
(unsigned)
```

---

### A5 — the pid ceiling holds

**Proves:** `--pids-limit` stops a process storm inside the sandbox from
becoming a process storm on the host.

We deliberately do **not** use a real fork bomb here. If the limit is not in
effect, a fork bomb takes the host down and the gate has no output to record —
the test would destroy its own evidence. A bounded storm fails visibly instead.

**Command:**

```bash
sbx nonet sh -c 'i=0; while [ $i -lt 2000 ]; do sleep 5 & i=$((i+1)); done; echo spawned=$i'
```

**Required output:** stderr names a fork failure (`Resource temporarily
unavailable`, `can't fork`, or `Cannot allocate memory`), and the host is
unaffected — `docker ps` on the host still answers immediately afterwards.

`spawned=2000` with no fork errors means the ceiling is not applied. Red.

**Evidence:**

```text
(unsigned)
```

---

### A6 — the memory ceiling is real

**Proves:** `--memory` with `--memory-swap` equal to it. Without the swap flag
the limit is soft, and an uploaded project can page the host to death instead of
dying itself.

**Command:**

```bash
sbx nonet node -e 'const a=[]; for(;;) a.push(Buffer.alloc(64*1024*1024))'
```

**Required output:** `exit: 137` — the container was OOM-killed. The host must
stay responsive throughout; check free memory on the host during the run.

`exit: 1` with a JS heap error is also acceptable **only** if Node died before
reaching the container limit; re-run with a larger allocation to force the
container ceiling, because the JS heap limit is Node's, not the sandbox's.

**Evidence:**

```text
(unsigned)
```

---

### A7 — a missing daemon fails loudly

**Proves:** docker mode never degrades to `direct`. The whole refusal design is
worthless if an unavailable daemon quietly turns into un-sandboxed execution.

**Command:**

```bash
docker compose exec -T worker sh -c 'mv /usr/bin/docker /usr/bin/docker.hidden 2>/dev/null || echo "read-only fs — use PATH override instead"'
docker compose exec -T -e PATH=/nonexistent worker python -c "
from pathlib import Path
from app.pipeline.sandbox import run, SandboxPolicy, SandboxError
try:
    run(['echo','hi'], Path('/data/workspaces/probe'), 10, policy=SandboxPolicy.from_env())
    print('FELL BACK — RED')
except SandboxError as e:
    print('REFUSED:', e)
"
```

**Required output:** `REFUSED:` followed by the message naming
`REJOX_SANDBOX=docker`. Any line containing `FELL BACK` is red, and is a
release blocker regardless of every other gate.

**Evidence:**

```text
(unsigned)
```

---

### A8 — the uploaded project's npm scripts never reach the output

**Proves:** the scaffolded React Native `package.json` is written by Rejox, not
inherited. An uploaded `postinstall` that survives into the emitted project runs
on the machine of whoever downloads it — the blast radius is the *user*, not
just this server.

**Command:**

Prepare a copy of the benchmark project carrying a marker script, migrate it,
and read the emitted `package.json` out of the downloaded artifact (B3's zip —
the same bytes a user receives):

```bash
cp -r test-projects/sample-app /tmp/a8-src
jq '.scripts += {"postinstall":"echo rejox-canary-a8"}' /tmp/a8-src/package.json > /tmp/pj \
  && mv /tmp/pj /tmp/a8-src/package.json
( cd /tmp && zip -qr /tmp/a8.zip a8-src )
# …upload, migrate and download as in B2/B3, then:
unzip -p /tmp/rejox-out.zip package.json | jq '.scripts'
unzip -p /tmp/rejox-out.zip package.json | grep -i 'rejox-canary' && echo "LEAKED — RED" || echo "clean"
```

**Required output:** `clean`, and `.scripts` containing **exactly** the Expo
scaffold's four entries — `start`, `android`, `ios`, `web` — and nothing else.
No `preinstall`, no `postinstall`, nothing carried from the source project.

**Evidence:**

```text
(unsigned)
```

---

### A9 — a non-registry dependency spec never reaches npm

**Proves:** the carry-over filter. A `https://…tgz`, `git+ssh://…`, `file:…`,
`github:…` or `npm:…` spec would let an uploader choose what `npm install`
fetches, inside a container that is deliberately given network access for
exactly that stage.

**Command:**

Migrate a project whose `package.json` pins `zustand` to a URL spec, then:

```bash
jq -r '.dependencies | to_entries[] | "\(.key)=\(.value)"' out/package.json \
  | grep -E '(https?://|git\+|file:|github:|npm:)' && echo "LEAKED — RED" || echo "clean"
```

**Required output:** `clean`. Every value is a plain semver range.

**Evidence:**

```text
(unsigned)
```

---

## Section B — Deployment

**What this section is worth:** the difference between an architecture diagram
and a running system. Section A proves the sandbox contains; this proves the
three services actually cooperate.

Run everything here against a real `docker compose up`, with
`REJOX_SANDBOX=docker` and `REJOX_API_KEYS` set — the production posture, not a
relaxed one. Set `KEY` to one of the configured keys first:

```bash
export KEY=<one of REJOX_API_KEYS>
export H="X-API-Key: $KEY"
```

---

### B0 — all three services come up and stay up

**Proves:** the compose file is deployable as written.

**Command:**

```bash
docker compose up -d --build
sleep 30
docker compose ps
curl -s localhost:8000/health
```

**Required output:** `docker compose ps` shows `redis`, `api` and `worker` all
`running` (redis `healthy`), and `/health` returns `{"status":"ok"}`.

Then wait five minutes and re-run `docker compose ps`. A container in a restart
loop looks identical to a healthy one in the first thirty seconds.

**Required output (second look):** the same three, still `running`, with
`RESTARTS` at `0`.

**Evidence:**

```text
(unsigned)
```

---

### B1 — the worker is registered with Redis and takes jobs

**Proves:** the worker actually connected to the queue. A worker that starts,
fails to reach Redis, and sits idle is indistinguishable from a working one
until the first migration never starts.

**Command:**

```bash
docker compose exec -T redis redis-cli SMEMBERS rq:workers
docker compose exec -T redis redis-cli KEYS 'rq:queue:*'
```

**Required output:** `SMEMBERS rq:workers` lists at least one worker, and the
queue key `rq:queue:rejox-migrations` exists.

An empty `rq:workers` set is red even if `docker compose ps` says the worker is
running.

**Evidence:**

```text
(unsigned)
```

---

### B2 — a full migration completes through the queue

**Proves:** the end-to-end path — upload, enqueue, a *different process* picks
it up, sandboxed install, typecheck, bundle, done.

**Command:**

```bash
( cd test-projects && zip -qr /tmp/sample-app.zip sample-app )
RUN=$(curl -s -X POST localhost:8000/api/upload -H "$H" -F "file=@/tmp/sample-app.zip" | jq -r .runId)
JOB=$(curl -s -X POST localhost:8000/api/migrate -H "$H" -H 'Content-Type: application/json' \
        -d "{\"runId\":\"$RUN\"}" | jq -r .jobId)
echo "run=$RUN job=$JOB"

# follow it; a real migration installs a dependency tree and runs Metro
while :; do
  S=$(curl -s localhost:8000/api/jobs/$JOB -H "$H" | jq -r .status)
  echo "$(date +%T) $S"; [ "$S" = succeeded ] || [ "$S" = failed ] && break
  sleep 15
done
curl -s localhost:8000/api/jobs/$JOB -H "$H" | jq '{status, error, stages: [.events[].stage] | unique}'
```

**Required output:** the status reaches `succeeded`, `error` is `null`, and the
stage list includes the install, typecheck and bundle stages. Record the
wall-clock duration — it is the number every later capacity decision is based
on.

**Also required, and easy to forget:** while the job is `running`, confirm on
the host that a *sandbox* container exists — a sibling started by the worker,
not the worker itself:

```bash
docker ps --format '{{.Image}}\t{{.Command}}\t{{.Status}}'
```

A migration that "succeeds" without any sandbox container ever appearing did
not run what it claims to have run.

**Evidence:**

```text
(unsigned)
```

---

### B3 — the emitted project is downloadable and real

**Proves:** the run workspace the API serves is the one the worker wrote — the
shared-volume half of the same question A1 asks about the sandbox.

**Command:**

```bash
curl -s -o /tmp/rejox-out.zip -w '%{http_code}\n' localhost:8000/api/runs/$RUN/download -H "$H"
unzip -l /tmp/rejox-out.zip | tail -5
unzip -p /tmp/rejox-out.zip package.json | jq '{name, main, dependencies: (.dependencies|keys|length)}'
```

**Required output:** HTTP `200`, a non-trivial file count, and a `package.json`
naming Expo's entry point with a plausible dependency count. A zip that opens
but contains three files is red.

**Evidence:**

```text
(unsigned)
```

---

### B4 — an API restart does not lose an in-flight job

**Proves:** the reason Redis is in this architecture at all. If a deploy kills
running migrations, the queue is decoration.

**Command:**

Start a migration as in B2, wait until its status is `running`, then:

```bash
docker compose restart api
sleep 20
curl -s localhost:8000/health
curl -s localhost:8000/api/jobs/$JOB -H "$H" | jq '{status, events: (.events|length)}'
```

**Required output:** `/health` is `ok` again, and the job's status is still
`running` (or already `succeeded`) with its event count **greater than or equal
to** what it was before the restart. A `404`, or a job frozen at the event count
it had when the API died, is red.

Let it run to completion and confirm it reaches `succeeded`.

**Evidence:**

```text
(unsigned)
```

---

### B5 — Redis down answers 503, fast, and never in-process

**Proves:** the no-fallback decision. A queue that silently degrades to a thread
turns a durable job into one that dies with the process, at exactly the moment
durability was the point.

**Command:**

```bash
docker compose stop redis
time curl -s -o /tmp/body.json -w '%{http_code}\n' -X POST localhost:8000/api/migrate \
  -H "$H" -H 'Content-Type: application/json' -d "{\"runId\":\"$RUN\"}"
cat /tmp/body.json
docker compose start redis
```

**Required output:** HTTP `503`, in **under 15 seconds** (two 5-second Redis
timeouts plus overhead), with a body naming Redis and the URL it could not
reach. Then, on the host, confirm no migration started anyway:

```bash
docker ps --format '{{.Image}}' | grep -c node   # expect 0
```

A `202` here is the worst possible outcome and is a release blocker: the client
is told the work was accepted and will poll a job that will never run.

**Evidence:**

```text
(unsigned)
```

---

### B6 — a killed worker does not silently strand a job

**Proves:** what an operator sees when capacity dies mid-migration. This gate is
allowed to record a known limitation rather than a pass — but it must record
something, because "we don't know" is the state we are trying to leave.

**Command:**

Start a migration, wait for `running`, then:

```bash
docker compose kill worker
sleep 10
curl -s localhost:8000/api/jobs/$JOB -H "$H" | jq '{status, error}'
docker compose start worker
sleep 60
curl -s localhost:8000/api/jobs/$JOB -H "$H" | jq '{status, error}'
```

**Required output:** the observed behaviour, written down plainly — whether the
job is re-queued, marked `failed`, or left `running` forever. If it is left
`running` forever, that is a finding to fix or to document in `docs/SECURITY.md`
as a known gap, not something to sign around.

**Evidence:**

```text
(unsigned)
```

---

### B7 — retention actually deletes a run workspace

**Proves:** `REJOX_RUN_TTL_SECONDS` is a real data-retention window and not a
comment. An uploaded project sits unencrypted on a shared volume for this
window; if the sweeper does not run, that window is forever.

**Command:**

```bash
docker compose exec -T api sh -c 'ls /data/workspaces | head'
docker compose exec -T -e REJOX_RUN_TTL_SECONDS=1 api rejox sweep --dry-run
docker compose exec -T -e REJOX_RUN_TTL_SECONDS=1 api rejox sweep
docker compose exec -T api sh -c 'ls /data/workspaces | head'
```

**Required output:** `--dry-run` names the run directories it would reap; the
real sweep removes them; the final listing no longer contains them. Confirm the
*files* are gone, not just the entry:

```bash
docker compose exec -T api sh -c 'du -sh /data/workspaces'
```

**Evidence:**

```text
(unsigned)
```

---

## Section C — HTTP surface

**What this section is worth:** who may spend the operator's money and read
other people's code.

Two gates here are deliberately **blocked** rather than unrun: they test
behaviour that does not exist yet. Leaving them visible and red is the point —
they are the reason the launch is not ready, and deleting them would make the
checklist lie by omission.

---

### C0 — a server with no keys refuses to serve

**Proves:** the refusal default. Shipping with an empty `REJOX_API_KEYS` must
not quietly mean "open to the internet".

**Command:**

```bash
docker compose -f docker-compose.yml run --rm -e REJOX_API_KEYS= -e REJOX_ALLOW_ANONYMOUS= \
  -p 8001:8000 api uvicorn app.main:app --host 0.0.0.0 --port 8000 &
sleep 5
curl -s -o /tmp/b -w '%{http_code}\n' -X POST localhost:8001/api/parse \
  -H 'Content-Type: application/json' -d '{"path":"/tmp"}'
cat /tmp/b
```

**Required output:** HTTP `503`, with a body that names `REJOX_API_KEYS` and
`REJOX_ALLOW_ANONYMOUS`. Note that the compose file itself refuses to start
without the variable — record which of the two refusals fired.

**Evidence:**

```text
(unsigned)
```

---

### C1 — a wrong key is rejected

**Proves:** the identity check is a check.

**Command:**

```bash
curl -s -o /dev/null -w 'no-key=%{http_code}\n'   -X POST localhost:8000/api/parse \
  -H 'Content-Type: application/json' -d '{"path":"/tmp"}'
curl -s -o /dev/null -w 'bad-key=%{http_code}\n'  -X POST localhost:8000/api/parse \
  -H 'X-API-Key: definitely-not-a-key' -H 'Content-Type: application/json' -d '{"path":"/tmp"}'
curl -s -o /dev/null -w 'good-key=%{http_code}\n' -X POST localhost:8000/api/parse \
  -H "$H" -H 'Content-Type: application/json' -d '{"path":"/tmp"}'
```

**Required output:** `no-key=401`, `bad-key=401`, and `good-key` **not** `401`
(a `422` or `400` from the body is fine — it means the gate let it through and
validation took over).

**Evidence:**

```text
(unsigned)
```

---

### C2 — the rate limit is shared across API replicas

> **Blocked.** Counters live in each API process
> (`backend/app/security.py`), so this gate cannot pass today. It is unblocked
> by moving them to Redis — plan step 6.

**Proves:** the limit is a limit, not a limit-per-container. With N replicas the
effective ceiling today is N times the configured one.

**Command:**

```bash
docker compose up -d --scale api=2   # requires removing the fixed host port
for i in $(seq 1 40); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST localhost:8000/api/upload -H "$H" -F "file=@/tmp/sample-app.zip"
done; echo
```

**Required output:** with `REJOX_RATE_UPLOAD=10`, exactly 10 responses that are
not `429`, then `429` for the rest — **regardless of replica count**. Twenty
successes across two replicas is the failure this gate exists to catch.

**Evidence:**

```text
(unsigned — blocked on plan step 6)
```

---

### C3 — a run belongs to one identity and no other

> **Blocked.** No ownership is recorded on a run today: `guard()` establishes an
> identity and nothing stores it, so `/api/runs/{runId}/download` and
> `/api/jobs/{jobId}` check only *that* the caller is authenticated, never *who*
> they are. Unblocked by plan step 7.

**Proves:** one user cannot download another user's source code. Today the only
protection is that a `runId` is a `uuid4` — unguessable, but not access control,
and it travels in URLs, logs and proxy access records.

**Command:**

With two distinct keys configured, upload as key A, then:

```bash
curl -s -o /dev/null -w 'owner=%{http_code}\n'    localhost:8000/api/runs/$RUN/download -H "X-API-Key: $KEY_A"
curl -s -o /dev/null -w 'stranger=%{http_code}\n' localhost:8000/api/runs/$RUN/download -H "X-API-Key: $KEY_B"
curl -s -o /dev/null -w 'job-stranger=%{http_code}\n' localhost:8000/api/jobs/$JOB     -H "X-API-Key: $KEY_B"
```

**Required output:** `owner=200`, `stranger=404`, `job-stranger=404`.

`404` rather than `403` on purpose: a `403` confirms the run exists, which is
itself a disclosure to someone who should not know.

**Evidence:**

```text
(unsigned — blocked on plan step 7)
```

---

### C4 — CORS is never a wildcard

**Proves:** a browser on an origin the operator did not name cannot drive this
API with a user's credentials.

**Command:**

```bash
curl -s -D- -o /dev/null -X OPTIONS localhost:8000/api/parse \
  -H 'Origin: https://evil.example' \
  -H 'Access-Control-Request-Method: POST' | grep -i 'access-control-allow'
curl -s -D- -o /dev/null -X OPTIONS localhost:8000/api/parse \
  -H "Origin: $(echo $REJOX_CORS_ORIGINS | cut -d, -f1)" \
  -H 'Access-Control-Request-Method: POST' | grep -i 'access-control-allow'
```

**Required output:** no `access-control-allow-origin` header at all for
`evil.example`, and the configured origin echoed back exactly (never `*`) for
the second.

**Evidence:**

```text
(unsigned)
```

---

### C5 — an oversized body is refused before it costs anything

**Proves:** the archive limits are enforced somewhere that a 100 MB upload
cannot first be buffered into the API process. Today the ingest limits apply
*after* the body has arrived; a reverse proxy with a body cap is what makes them
cheap.

**Command:**

```bash
head -c 200000000 /dev/urandom > /tmp/big.zip   # 200 MB, over the 100 MB limit
time curl -s -o /tmp/b -w '%{http_code}\n' -X POST localhost:8000/api/upload -H "$H" -F "file=@/tmp/big.zip"
cat /tmp/b
```

**Required output:** a `413` (proxy) or `400` (ingest) with a message naming the
limit — and, critically, the API container's memory during the upload stays
bounded. Watch it:

```bash
docker stats --no-stream $(docker compose ps -q api)
```

Record the peak. If the whole body is held in memory, note it as a finding: that
is a denial-of-service with a single request, and the fix is a proxy cap rather
than application code.

**Evidence:**

```text
(unsigned)
```

---

## Section D — CI keeps this true

**What this section is worth:** everything above, six months from now. A gate
signed once and never re-run is a claim about a commit nobody remembers.

---

### D0 — docker mode is exercised in CI

**Proves:** Section A re-runs on every change to the sandbox. Today
`.github/workflows/ci.yml` sets `REJOX_ALLOW_UNSANDBOXED=1` for every job and
the `docker` job only *builds* the image — so no CI run has ever executed a
sandboxed command.

**Required output:** a CI job that sets `REJOX_SANDBOX=docker` (and does **not**
set `REJOX_ALLOW_UNSANDBOXED`), runs the A-gate assertions as tests against the
runner's daemon, and is required for merge. Paste the green run's URL.

**Evidence:**

```text
(unsigned — plan step 5)
```

---

### D1 — the compose deployment is exercised in CI

**Proves:** Section B re-runs on every change to compose, the queue or jobs.

**Required output:** a CI job that runs `docker compose up`, executes B1, B2 and
B5 against it, and fails the build on any of them. Paste the green run's URL.

**Evidence:**

```text
(unsigned — plan step 5)
```

---

## Section E — Operability

**What this section is worth:** the first week after launch. These gates are not
about security; they are about whether anyone can tell what happened.

---

### E0 — a failed migration is diagnosable after the fact

**Proves:** that when someone's real project fails, the answer is not "we don't
know". This is the gate most likely to be waved through and most likely to be
regretted.

**Command:**

Migrate a project that is known to fail (a deliberately broken fixture), then,
using **only** what a deployment retains — not the developer's terminal:

```bash
docker compose logs --since 30m api worker | tail -50
curl -s localhost:8000/api/jobs/$JOB -H "$H" | jq '{status, error, events: [.events[] | {stage, type}]}'
```

**Required output:** it must be possible to state, from that output alone, which
stage failed and why. Write the answer into the evidence block. If the honest
answer is "the logs do not say", this gate is red and the fix is structured
logging with a run/job id on every line.

**Evidence:**

```text
(unsigned)
```

---

### E1 — one identity cannot fill the disk

**Proves:** the cheapest denial of service left. The upload budget is 10 per
minute and the expanded ceiling is 500 MB per archive; retention is 24 hours.
Nothing checks free space.

**Command:**

```bash
docker compose exec -T api sh -c 'df -h /data'
# upload repeatedly, at the configured rate limit, for several minutes
docker compose exec -T api sh -c 'df -h /data; du -sh /data/workspaces'
```

**Required output:** a written answer to two questions — how much disk a single
identity can consume within one retention window, and what the API does when
`/data` is full. If the answer to the second is "unknown", fill the volume
deliberately in a scratch environment and find out.

**Evidence:**

```text
(unsigned)
```

---

### E2 — one upload cannot spend unbounded LLM quota

**Proves:** the budget is on cost, not just on request count. `REJOX_RATE_MIGRATE`
counts requests per minute; a single large project is one request and an
unbounded number of resolution calls.

**Command:**

Migrate the largest project in `hardening-projects/` with the real provider and
record the AI call count and token usage the run reports.

**Required output:** the measured worst case for one migration, and a decision
recorded here: either a per-run ceiling exists, or the operator accepts the
measured number as the per-request exposure. An unmeasured "it's probably fine"
does not sign this gate.

**Evidence:**

```text
(unsigned)
```

---

## Sign-off

Launch is authorised when every gate in **A**, **B** and **C** is signed, **D**
is green in CI, and **E** has recorded answers — not necessarily fixes, but
answers.

| Section | Gates | Signed | Blocker if red |
| --- | --- | --- | --- |
| A — Containment | 10 | 0 / 10 | yes — absolute |
| B — Deployment | 8 | 0 / 8 | yes |
| C — HTTP surface | 6 | 0 / 6 | yes |
| D — CI | 2 | 0 / 2 | yes |
| E — Operability | 3 | 0 / 3 | answers required, fixes negotiable |

```text
Launch authorised by: ____________________  date: __________
Commit signed off:    ____________________
```
