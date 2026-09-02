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
| `backend/app/main.py`, `backend/app/pipeline/workspace.py` | C3 |
| `docker-compose.yml`, `backend/Dockerfile` | A0, A1, all of **B** |

Section **D** exists so that these re-runs are not a matter of anyone
remembering.

---

## Status at a glance

Signed 2026-08-31 against Docker Desktop 29.6.2 on macOS, commit 6c504e4 —
three full migrations (`test-projects/sample-app`, plus a copy carrying a
hostile `postinstall` and a URL dependency spec), one API restart mid-job, one
deliberate worker kill, and a deliberate Redis outage.

Re-run 2026-09-01 against the same host, commit `4468bc4`, by
`./verify-deployment.sh`: A0, A1, A8, A9, B0, B1, B2, B3, B5, **C2** and **C3**
all green in one pass. That run also caught B5 passing for the wrong reason —
see its entry.

Re-run 2026-09-03 against the same host, commit `9990f35`, after the jobs.py
heartbeat change re-red all of section B: **A0, A1, A8, A9, B0, B1, B2, B3, B5,
C2 and C3 green in one `./verify-deployment.sh` pass**, then **B4, B6 and B7 by
hand** — the three that script does not cover. B6, red since 2026-08-31, is now
signed green. B7 was RED on its first attempt and found a live bug in
`rejox sweep --dry-run`; it is signed on the re-run after the fix, with the
finding kept.

Fixing B7 changed `backend/app/pipeline/workspace.py`, which the table above
says invalidates **C3** — so C3 was re-red rather than argued out of, and then
re-earned: a second `./verify-deployment.sh` pass on commit `ee6df56`, a tree
that carries the change, green on all eight of its checks. Sections **A, B and
C are now signed in full**.

**Three gates found release blockers that code review had not.** A0, B2 and C3
were red on their first run and are signed with the failure kept in place. Every
signature below carries the output it came from.

| Gate | Proves | Status |
| --- | --- | --- |
| A0 | the worker can reach a Docker daemon at all | ☑ signed — RED first (socket permission), fixed |
| A1 | a sandboxed command runs, in the right directory | ☑ signed — canary read back, negative control refused |
| A2 | the container is non-root and holds no capabilities | ☑ signed |
| A3 | only the run directory is writable | ☑ signed |
| A4 | network is off for stages that did not ask for it | ☑ signed |
| A5 | the pid ceiling stops a fork storm | ☑ signed |
| A6 | the memory ceiling is real, and the host survives it | ☑ signed — see the timeout note |
| A7 | a missing daemon fails loudly instead of degrading | ☑ signed |
| A8 | the uploaded project's npm scripts never reach the output | ☑ signed — hostile postinstall dropped |
| A9 | a non-registry dependency spec never reaches `npm install` | ☑ signed — URL spec dropped |
| B0 | all three services come up and stay up | ☑ signed — re-signed 2026-09-03 (×2) |
| B1 | the worker is registered with Redis and takes jobs | ☑ signed — re-signed 2026-09-03 (×2) |
| B2 | a full migration completes through the queue | ☑ signed — RED first (API served stale state), fixed; re-signed 2026-09-03 (×2) |
| B3 | the emitted project is downloadable and real | ☑ signed — re-signed 2026-09-03 (×2) |
| B4 | an API restart does not lose an in-flight job | ☑ signed — re-signed 2026-09-03 (×2); also proves the heartbeat spares a live worker |
| B5 | Redis down answers 503 — fast, and never in-process | ☑ signed — 503 in <1s, queue refusal asserted directly; re-signed 2026-09-03 (×2) |
| B6 | a killed worker does not silently strand a job | ☑ signed — RED first (wedged at `running` for ever), fixed 2026-09-03; re-signed (×2) |
| B7 | retention actually deletes a run workspace | ☑ signed — RED first (the dry run over-promised), fixed; re-signed (×2), 27-for-27 at 1.1G |
| C0 | a server with no keys refuses to serve | ☑ signed |
| C1 | a wrong key is rejected | ☑ signed |
| C2 | the rate limit is shared across API replicas | ☑ signed — 2 replicas, 40 requests, 10 allowed |
| C3 | a run belongs to one identity and no other | ☑ signed — RED first (a second identity downloaded another's run), fixed; re-signed 2026-09-03 |
| C4 | CORS is never a wildcard | ☑ signed |
| C5 | an oversized body is refused before it costs anything | ☑ signed — refused at 400, API peak 80 MiB |
| D0 | docker mode is exercised in CI, not just on someone's laptop | ◐ green in CI ×3 — awaiting the required-status-check setting |
| D1 | the compose deployment is exercised in CI | ◐ green in CI ×3 — awaiting the required-status-check setting |
| E0 | a failed migration is diagnosable after the fact | ☒ **RED** — the `Job OK` lie is fixed; the silence (no run/job logging) remains |
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

cwd = Path("${REJOX_DATA_DIR}/workspaces/probe")  # e.g. /srv/rejox-data/workspaces/probe
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ docker compose exec -T worker sh -c 'docker version --format "{{.Server.Version}}"'
Server 29.6.2

FIRST RUN WAS RED, and this is why the gate exists:

    permission denied while trying to connect to the docker API at
    unix:///var/run/docker.sock

/var/run/docker.sock is `srw-rw---- root root`; the image runs as uid 10001, so
the compose deployment as written could never start a sandbox container — on
any host, not just this one. Fixed by giving the worker the socket's group
(`group_add: ["${REJOX_DOCKER_GID}"]`, commit fced909) rather than running it
as root. Re-run above is green.
```

---

### A1 — a sandboxed command runs, in the right directory

**Proves:** the run directory the worker passes to `docker run -v` resolves to
the same bytes inside the sandbox container. This is the gate that catches the
sibling-container path mismatch: the worker is itself a container talking to the
host's daemon, so the run directory is a path the *worker* has and the
*host* may not. A named volume guarantees they differ.

**Command:**

```bash
docker compose exec -T worker sh -c 'mkdir -p $REJOX_WORKSPACE_ROOT/probe && echo canary-a1 > $REJOX_WORKSPACE_ROOT/probe/canary.txt'
sbx nonet cat canary.txt
```

**Required output:** `exit: 0` and stdout containing exactly `canary-a1`.

An empty stdout with `exit: 0` is a **failure**, not a pass — it means the
sandbox mounted a different, empty directory of the same name and every
validation result computed against it is fiction. This is the single most
dangerous way this system can be wrong, because it looks green.

The deployment now avoids this by bind-mounting the workspace root at an
identical path on both sides (`REJOX_DATA_DIR`), and
`sandbox.assert_run_dir_is_visible()` proves the mount before any stage runs —
so the expected failure mode here is a loud `SandboxError`, not a silent empty
directory. **Neither of those is evidence.** This gate stays unsigned until the
canary has actually been read back through a live daemon: the point of the gate
is that the fix is unverified until someone watches it work.

**Evidence:**

```text
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ docker compose exec -T worker sh -c 'echo canary-a1 > .../probe/canary.txt'
$ sbx nonet cat canary.txt
exit: 0
--- stdout ---
canary-a1

NEGATIVE CONTROL — the same call against a path the worker has and the host does
not (/tmp/worker-only-dir), to prove the green above means something:

    REFUSED as designed:
    The sandbox was handed a directory that is not the run directory.
    Wrote a probe into /tmp/worker-only-dir and the container read back '' (exit 1).

Without the check that call would have mounted a new empty directory and every
stage would have validated nothing while reporting success.
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ sbx nonet id
uid=10001 gid=10001 groups=10001
$ sbx nonet sh -c 'grep -E "^(CapEff|NoNewPrivs)" /proc/self/status'
CapEff:	0000000000000000
NoNewPrivs:	1
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ sbx nonet sh -c 'touch /etc/probe-a3; ... /work ... /tmp ...'
touch: cannot touch '/etc/probe-a3': Read-only file system
etc-write-rc=1
work-write-rc=0
tmp-write-rc=0
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ sbx nonet node -e '...dns.lookup("registry.npmjs.org")...'
BLOCKED
$ sbx net   node -e '...dns.lookup("registry.npmjs.org")...'
REACHED
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ sbx nonet sh -c 'i=0; while [ $i -lt 2000 ]; do sleep 5 & i=$((i+1)); done; echo spawned=$i'
exit: 2
--- stderr ---
sh: 0: Cannot fork

`spawned=` never printed — the loop died at the ceiling. Host unaffected:
`docker ps -q | wc -l` answered immediately with 3 (the compose services).
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
Run with REJOX_SANDBOX_MEMORY=2g.
$ node -e 'const a=[]; let mb=0; for(;;){ a.push(Buffer.alloc(64*1024*1024,1)); mb+=64; ... }'
exit: 137
stdout tail: ['allocated_mb=512', 'allocated_mb=1024', 'allocated_mb=1536']

OOM-killed at the ceiling, host responsive throughout.

NOTE ON THE COMMAND ABOVE: the first attempt used the probe helper's 120s
timeout and raised `subprocess.TimeoutExpired` before the container reached the
limit — zero-filling 2 GB inside the sandbox takes longer than that on this
host. Allow ≥300s and print progress, or the gate reports a timeout and tells
you nothing about the ceiling.
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ docker compose exec -T worker python -c "os.environ['PATH']='/nonexistent'; sandbox.run(...)"
REFUSED: REJOX_SANDBOX=docker but `docker` is not on PATH. Refusing to fall back
to un-sandboxed execution.

No line containing FELL BACK.
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
Fixture: test-projects/sample-app with `"postinstall": "echo rejox-canary-a8"`
added to its package.json, uploaded and migrated end to end (run 67faf4d2…).

$ jq '.scripts' <emitted>/package.json
{
  "start": "expo start",
  "android": "expo start --android",
  "ios": "expo start --ios",
  "web": "expo start --web"
}
$ grep -c 'rejox-canary' <emitted>/package.json
0

Exactly the four scaffold entries. The uploaded postinstall did not survive.
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
Same fixture, with `"evil-pkg": "https://evil.example.com/pkg.tgz"` added to its
dependencies.

$ jq -r '.dependencies | to_entries[] | "\(.key)=\(.value)"' <emitted>/package.json
axios=^1.18.1
expo=~52.0.0
expo-asset=~11.0.5
expo-status-bar=~2.0.0
react=18.3.1
react-native=0.76.5
zustand=^5.0.14
$ ... | grep -cE '(https?://|git\+|file:|github:|npm:)'
0

`evil-pkg` was dropped entirely; every survivor is a plain semver range.
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
Signed: 2026-09-03 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 3c27cdf — re-signed after `run_job` was changed to raise MigrationFailed (gate E0, finding 2). 0 FAIL across the whole pass.
  PASS  health — {"status":"ok"}

Signed: 2026-09-03 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 9990f35 — re-signed after the jobs.py heartbeat change (B6).
$ ./verify-deployment.sh
  PASS  health — {"status":"ok"}
  PASS  redis is running — running
  PASS  api is running — running
  PASS  worker is running — running

Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ docker compose up -d && curl -s localhost:8000/health
SERVICE   STATUS
api       Up (healthy)
redis     Up (healthy)
worker    Up
{"status":"ok"}

Still running, RESTARTS 0, after ~40 minutes of gate work including three full
migrations, an API restart and a deliberate worker kill.
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
Signed: 2026-09-03 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 3c27cdf — re-signed after `run_job` was changed to raise MigrationFailed (gate E0, finding 2). 0 FAIL across the whole pass.
  PASS  1 worker(s) registered

Signed: 2026-09-03 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 9990f35 — re-signed after the jobs.py heartbeat change (B6).
  PASS  1 worker(s) registered

Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ docker compose exec -T redis redis-cli SMEMBERS rq:workers
rq:worker:4e77d2a87f544af59d24b8fa146e9c5a

`rq:queue:rejox-migrations` did not exist at this point and that is correct —
RQ creates the key on first enqueue. After B2 the queue and registry keys
(rq:wip:…, rq:finished:…, rq:job:…) were all present.
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
Signed: 2026-09-03 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 3c27cdf — re-signed after `run_job` was changed to raise MigrationFailed (gate E0, finding 2). 0 FAIL across the whole pass.
  PASS  migration status — succeeded
  PASS  a sibling sandbox container was observed on the host during the run

  Note for this re-run: a SUCCEEDING migration must not trip the new raise.
  It did not — the job reached `succeeded` and the worker logged no exception.

Signed: 2026-09-03 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 9990f35 — re-signed after the jobs.py heartbeat change (B6).
  PASS  uploaded — runId d65beb218874464a86a081ff39d1402e
  PASS  enqueued — jobId db80f12823fd4ec6ac1431b2c25a0c74
  PASS  migration status — succeeded
  PASS  a sibling sandbox container was observed on the host during the run

Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ POST /api/upload  → runId aec3597124ea4c42a309ed7e4adb9738
$ POST /api/migrate → 202 {"jobId":"a2ee8714…","status":"queued"}
$ GET  /api/jobs/a2ee8714…
{"status":"succeeded","nevents":12,
 "stages":["bundle","done","emit","install","repair","typecheck"],
 "last":"Migration complete"}

Wall clock: ~7 minutes (upload → succeeded), sample-app, install + tsc + Metro.

SIBLING CONTAINER CONFIRMED — polled `docker ps` on the host during the run:
    node:20-bookworm-slim | "docker-entrypoint.s…" | Up 3 seconds
so the stages really executed in a throw-away sandbox, not in the worker.

FIRST RUN WAS RED, and it is the most valuable thing this gate found:

    on disk:  {"status":"succeeded","nevents":12,"last":"Migration complete"}
    via API:  {"status":"queued","nevents":0}

A complete, successful migration that the API reported as never having started.
`create_job()` registered the job in the API process's in-memory `_REGISTRY`,
and `get_job()` prefers memory over the file — so with the `rq` backend the API
answered from its own stale copy forever while the worker advanced job.json.
Every client (the UI's SSE stream included) would have hung on "queued" through
a migration that had already finished. Fixed in commit c5e318d: only the process
executing a job keeps a memory copy. Re-read after the fix is the output above.
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
Signed: 2026-09-03 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 3c27cdf — re-signed after `run_job` was changed to raise MigrationFailed (gate E0, finding 2). 0 FAIL across the whole pass.
  PASS  download — 200
  PASS  41 files in the archive

Signed: 2026-09-03 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 9990f35 — re-signed after the jobs.py heartbeat change (B6).
  PASS  download — 200
  PASS  41 files in the archive
  PASS  no mount probe leaked into the artifact — 0

Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ curl -o out.zip -w '%{http_code} %{size_download}' .../api/runs/aec3597…/download
http=200 bytes=118200
$ unzip -l out.zip | tail -1
   462769  41 files
$ unzip -p out.zip package.json | jq '{name, main, ndeps:(.dependencies|keys|length)}'
{"name":"sample-app","main":"index.ts","ndeps":7}

Also checked: the mount probe left nothing behind —
`unzip -l out.zip | grep -c 'rejox-mount-probe'` → 0.
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

Since 2026-09-02 this gate also separates the heartbeat from the wedge it
replaced: here the WORKER never died, so its beats keep landing in job.json
across the API restart and the job must stay `running`. A `WorkerLost` failure
in this scenario would mean the grace is too narrow, not that B4 passed.

**Evidence:**

```text
Signed: 2026-09-03 — Ashraf (live run, Docker Desktop 29.6.2, macOS) — commit 3c27cdf — re-signed after `run_job` was changed to raise MigrationFailed (gate E0).

Job 5555ba3c22364e6d8b7b3150c4807359, run 96a1b17933fd4c6bb5e6c189ade31db1.
before restart: {"status":"running","nevents":1}
$ curl /health   -> {"status":"ok"}
after restart:  {"status":"running","nevents":1}
final:          {"status":"succeeded","nevents":12,"error":null}

Carries the same control as before — no WorkerLost on a live worker — and one
more for this change: a migration that SUCCEEDS must not trip the new raise.
It reached `succeeded` and the worker logged no exception.

Signed: 2026-09-03 — Ashraf (live run, Docker Desktop 29.6.2, macOS) — commit 9990f35 — re-signed after the jobs.py heartbeat change, and it is this gate that proves the heartbeat does not misfire on a live worker.

Job 832f53499f8f4cbbb748348df5a2f0e0, run 819ba6e5260d45989b5dd198430baec9.
The worker reported REJOX_JOB_HEARTBEAT=10 REJOX_JOB_HEARTBEAT_GRACE=60 —
forwarded by compose, read from inside the container, not assumed.

before restart: {"status":"running","nevents":1}
$ docker compose restart api
$ curl /health   -> {"status":"ok"}
after restart:  {"status":"running","nevents":1}
events before=1 after=1
final:          {"status":"succeeded","nevents":12,"error":null}

The worker never died here, so its beats kept landing across the API restart:
the job stayed `running` and finished. A WorkerLost in this scenario would have
meant the grace was too narrow. It did not appear.

⟲ RE-RED 2026-09-02 by the jobs.py heartbeat change. The signature below stands
as the record of the last time this was observed, and must be re-earned.

Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
Job c4ac349c… started, waited for status `running`, then:
$ docker compose restart api
before restart: {"status":"running","nevents":0}
after  restart: {"status":"running","nevents":3,"last":"npm install started"}
final:          {"status":"succeeded","nevents":12,"last":"Migration complete"}

/health answered ok again within seconds. The event count rose across the
restart, which is the point: the API is reading the worker's file, not its own
memory, and the migration was never interrupted.
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

**And assert the queue directly.** Since `REJOX_RATE_STORE=redis`, the rate
limiter shares that Redis and refuses *before* the request reaches the queue —
so the 503 above proves the surface refuses somewhere, not that the queue
refuses. Both matter, so the queue's own decision is asserted on its own:

```bash
docker compose exec -T api python -c "
from pathlib import Path
from app import queue
try:
    queue.enqueue('gate-b5', source_root=Path('/tmp'), run_id='0'*32,
                  out_dir=Path('/tmp'), answers={}, install=False, run_bundle=False)
    print('ENQUEUED')
except queue.QueueError:
    print('QUEUE-REFUSED')"
```

**Required output:** `QUEUE-REFUSED`. `ENQUEUED` would mean a dead queue
accepted work; anything else means it failed for a reason nobody predicted.

**Evidence:**

```text
Signed: 2026-09-03 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 3c27cdf — re-signed after `run_job` was changed to raise MigrationFailed (gate E0, finding 2). 0 FAIL across the whole pass.
  PASS  status with Redis down — 503
  PASS  the queue itself refuses, never a thread fallback — QUEUE-REFUSED

Signed: 2026-09-03 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 9990f35 — re-signed after the jobs.py heartbeat change (B6).
  PASS  status with Redis down — 503
  PASS  answered in 0s (must not hang)
  PASS  the body names Redis: {"detail":"Rate-limit store at redis://redis:6379/0 is
        unreachable: Error -2 connecting to redis:6379. Name or service not known."}
  PASS  the queue itself refuses, never a thread fallback — QUEUE-REFUSED

Signed: 2026-09-01 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 4468bc4 — re-signed after REJOX_RATE_STORE=redis changed which refusal answers first.

$ docker compose stop redis
$ POST /api/migrate
http=503   elapsed=0s
{"detail":"Rate-limit store at redis://redis:6379/0 is unreachable: Error -2
 connecting to redis:6379. Name or service not known."}
$ queue.enqueue(...) inside the api container
QUEUE-REFUSED

Note what changed, because the gate nearly stopped testing its own claim: the
503 now comes from the RATE LIMITER, not the queue — with counters in Redis, the
limiter runs first and Redis is a hard dependency of every guarded endpoint, not
just of /api/migrate. The old body check (`grep -i redis`) passed on the new
message without noticing. The queue's refusal is now asserted directly, which is
what this gate is actually about.

---

Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ docker compose stop redis
$ POST /api/migrate
http=503   elapsed=0s
{"detail":"Could not enqueue to Redis at redis://redis:6379/0: Error -2
 connecting to redis:6379. Name or service not known."}
$ docker ps --format '{{.Image}}' | grep -c node
0

Well under the 15s bound (DNS resolution fails immediately inside the compose
network). Nothing started anyway: no silent fallback to an in-process thread.
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
Signed: 2026-09-03 — Ashraf (live run, Docker Desktop 29.6.2, macOS) — commit 3c27cdf — re-signed after the MigrationFailed change (gate E0). GREEN, unchanged.

Job 71743a5f5e1b47a1b19a5819dfe1b4b8, run a6b678641c184520b698065da56cb634.
before the kill:      {"status":"running","nevents":1,"error":null}
+10s (inside grace):  {"status":"running","error":null}
+70s (past grace):    {"status":"failed","error":{"type":"WorkerLost",
                       "stage":"emit","message":"...no heartbeat for 72s..."}}
$ docker compose start worker
+60s after restart:   {"status":"failed","error":"WorkerLost"}
$ redis-cli HGET rq:job:71743a5f… status   -> started

Worth re-running rather than assuming: the E0 fix makes `run_job` raise on a
failed migration, and this is the one failure where `run_job` never returns at
all — the worker is killed mid-stage, so nothing raises and the API's
reconciler is still the only party that can rule the job lost. It still does.

Signed: 2026-09-03 — Ashraf (live run, Docker Desktop 29.6.2, macOS) — commit 9990f35 — GREEN. This gate has been red once (2026-08-31, below) and that record stays.

Job db527195781c4450aa589ce54404a907, run b7233ed36954421ba07fa3b3600834e8.

before the kill:      {"status":"running","nevents":1,"error":null}
$ docker compose kill worker
+10s (inside grace):  {"status":"running","error":null}
+70s (past grace):    {"status":"failed","error":{"type":"WorkerLost","message":
                       "The process running this migration stopped without
                        reporting a result (no heartbeat for 72s, past the 60s
                        grace). The migration did not complete; start it
                        again.","stage":"emit"}}
the terminal event:   {"seq":2,"type":"failed","stage":"emit","message":"…"}
$ docker compose start worker
+60s after restart:   {"status":"failed","error":"WorkerLost"}

$ docker compose exec -T redis redis-cli HGET rq:job:db527195… status
started
$ docker compose exec -T redis redis-cli ZRANGE rq:wip:rejox-migrations 0 -1
db527195781c4450aa589ce54404a907:48af1a0ef08d4672a019bc19db8e5cd7

RQ's own view is unchanged from the 2026-08-31 finding — the execution is still
held as `started`, still in the wip set, and the restarted worker did not pick
it back up. That is the point: the migration is NOT recovered. What changed is
that the API no longer reports it as `running`. It answers `failed`, names the
stage it died in, and says what to do. The client stops polling.

Both edges were observed, not just the one that passes: at +10s, inside the
grace, the job was still `running` — the reconciler does not fire early. And a
restarted worker did not resurrect it.

WHAT CHANGED (commit V1.2–V1.5, `backend/app/jobs.py`): the process executing a
migration stamps `updatedAt` into job.json every REJOX_JOB_HEARTBEAT seconds
(default 10), started in `run_job` and stopped in its `finally`. `get_job` and
`events_after` reconcile the persisted path only: a `running` job with no beat
for REJOX_JOB_HEARTBEAT_GRACE seconds (default 60) gets a terminal `failed`
event of type `WorkerLost`, written back to job.json so every later reader
agrees. A heartbeat appends no event — nothing happened — it only moves the
timestamp.

The migration is still LOST, not recovered: nothing re-queues it. This gate
asks what an operator sees, and the answer is now a failure with a reason
instead of `running` for ever.

$ pytest -q tests/test_jobs.py -k "worker_died or heartbeating or queued_job_is_never or heartbeat_keeps"
4 passed

That is what the run above observed, on all three points.

--- the original finding, kept in place ---

Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4 — RED, recorded as a finding rather than a pass.

Job b3c1357d… running, then `docker compose kill worker`:
    10s after the kill:            {"status":"running","nevents":1,"error":null}
    worker restarted, +90s:        {"status":"running","nevents":1,"error":null}
    $ redis-cli ZRANGE rq:wip:rejox-migrations 0 -1
      b3c1357d86a645b3aa91311e8ec6bb0a:bbae4495…
    $ redis-cli HGET rq:job:b3c1357d… status
      started            (no ended_at)

FINDING: a job whose worker dies is wedged at `running` for ever in the API's
view. The restarted worker logged "Cleaning registries for queue" and went
straight to Listening — it did not pick the job back up — and RQ still holds the
execution as `started`, so nothing re-queues it.

RQ's own record will eventually age out to the failed registry when
REJOX_JOB_TIMEOUT (3600s) expires; that was NOT waited out here. It would not
help either way: `job.json` is what /api/jobs serves, and it is only ever
written by `_emit_sink`/`run_job` inside the executing process. When that
process dies there is no reconciliation between RQ's registries and job.json
(verified by reading app/jobs.py, not by running it), so the client polls a job
that will never change.

Not a launch blocker on its own — but it must be fixed or documented in
docs/SECURITY.md as a known gap before real users can be told what "running"
means.

[2026-09-02: fixed, see above. docs/SECURITY.md now describes the residue —
the job is lost and reported, not recovered.]
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
Signed: 2026-09-03 — Ashraf (live run, Docker Desktop 29.6.2, macOS) — commit 3c27cdf — re-signed after the MigrationFailed change, and the first run of this gate at real scale.

$ ls .../workspaces   -> 28 entries, 1.1G
$ rejox sweep --dry-run  (TTL=1s)   -> 27 run(s), listed
$ rejox sweep            (TTL=1s)   -> 27 run(s) reaped, the SAME 27
$ ls .../workspaces   -> 1 entry (gate-probe), 4.0K

27 for 27, across a directory holding 1.1G — the preview/sweep agreement fixed
earlier today holds at a size where a mismatch would actually cost something,
and the one non-run directory was again neither claimed nor touched.

Signed: 2026-09-03 — Ashraf (live run, Docker Desktop 29.6.2, macOS) — commit c1d4fea — GREEN, on the second attempt. THE FIRST ATTEMPT WAS RED, and the finding is below.

$ ls .../workspaces          -> 3 runs + gate-probe   (entries: 4, 772K)
$ rejox sweep --dry-run  (REJOX_RUN_TTL_SECONDS=1)
  would reap 6148df18b05f46928456659cfe3ae0ac
  would reap 8347749544bd4b02a8c3e8cd036f079e
  would reap fa8812950d7c42178b2d81bc95068613
  3 run(s) past a 1s window (dry run — nothing deleted)
$ rejox sweep            (REJOX_RUN_TTL_SECONDS=1)
  reaped 6148df18b05f46928456659cfe3ae0ac
  reaped 8347749544bd4b02a8c3e8cd036f079e
  reaped fa8812950d7c42178b2d81bc95068613
  3 run(s) reaped past a 1s window.
$ ls .../workspaces          -> gate-probe            (entries: 1, 4.0K)

The preview named exactly what the sweep deleted, the files are genuinely gone
(772K -> 4.0K), and the one directory that is not a run was neither claimed nor
touched.

FIRST ATTEMPT WAS RED — 2026-09-03, commit 9990f35, and this is why the gate
asks for the final listing rather than just the sweep's own count:

  $ rejox sweep --dry-run   ->  15 run(s), including `gate-probe`
  $ rejox sweep             ->  14 run(s) reaped
  $ ls .../workspaces       ->  gate-probe still there

FINDING: `rejox sweep --dry-run` carried its own copy of the expiry predicate
(app/cli.py) and had dropped the run-id filter that workspace.sweep() applies,
so the preview announced it would delete a directory the real sweep would never
touch. A retention preview that overstates what it deletes is worse than no
preview: it is exactly the tool an operator uses to decide whether a sweep is
safe to run. Fixed in commit 29237e2 by making `workspace.expired_runs()` the
one definition both ask, with a regression test (commit c1d4fea) that fails if
the two ever disagree again.

The 2026-08-31 signature below shows the same discrepancy in the opposite
direction (dry run named 3, sweep reaped 4) and it was not chased. It was the
same bug.

Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ ls .../workspaces | wc -l ; du -sh .../workspaces
5    1.1G
$ docker compose exec -T -e REJOX_RUN_TTL_SECONDS=1 api rejox sweep --dry-run
  would reap 67faf4d2…, aec35971…, probe        (3 run(s), nothing deleted)
$ docker compose exec -T -e REJOX_RUN_TTL_SECONDS=1 api rejox sweep
  reaped 67faf4d2…, 83c7e50d…, aec35971…, b20e9666…
  4 run(s) reaped past a 1s window.
$ ls .../workspaces | wc -l ; du -sh .../workspaces
1    4.0K

The files are genuinely gone, not just the directory entries.

NOTE: the sweep reaped b20e9666… — the workspace of the B6 job that was still
marked `running`. Retention has no notion of an in-flight run. Harmless at the
24h default; with a short TTL and a long migration it would delete a workspace
out from under a live job.
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
Two refusals, both fired:
$ env -u REJOX_API_KEYS docker compose --env-file /dev/null config
rc=1  required variable REJOX_DATA_DIR is missing a value: set REJOX_DATA_DIR in .env
(the compose file refuses before the app is even built — REJOX_DATA_DIR is
checked first, REJOX_API_KEYS is guarded the same way)

$ docker compose run --rm -e REJOX_API_KEYS= -e REJOX_ALLOW_ANONYMOUS= api ...
http = 503
body = This Rejox server has no API keys configured, so it will not serve
requests. Set REJOX_API_KEYS (comma-separated), or REJOX_ALLOW_ANONYMOUS=1 for
a local development server.
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ POST /api/parse  (no key)                      no-key=401
$ POST /api/parse  -H 'X-API-Key: definitely-not-a-key'   bad-key=401
$ POST /api/parse  -H 'X-API-Key: gate-key-alpha'         good-key=200
```

---

### C2 — the rate limit is shared across API replicas

**Proves:** the limit is a limit, not a limit-per-container. With counters in
each API process the effective ceiling is N times the configured one.

Since plan step 6, `REJOX_RATE_STORE` decides where the counters live and
compose sets `redis`. The gate is therefore not "does the code have a Redis
path" but "do two live replicas actually share one budget".

**Command:**

Covered by `./verify-deployment.sh`, which runs it last — it is the only gate
that changes the topology. By hand:

```bash
docker compose -f docker-compose.yml -f docker-compose.c2.yml up -d --scale api=2
for i in $(seq 1 40); do
  p=$(( i % 2 == 1 ? 8000 : 8001 ))
  curl -s -o /dev/null -w '%{http_code} ' -X POST localhost:$p/api/upload -H "$H" -F "file=@/tmp/sample-app.zip"
done; echo
```

The override file replaces the fixed host port with a two-port range, so the
replicas land on `8000` and `8001` and each can be addressed directly. Deliberate:
behind a load balancer, "did both replicas actually serve?" is left to chance,
and this gate is worthless unless they did.

**Required output:** with `REJOX_RATE_UPLOAD=10`, exactly 10 responses that are
not `429`, then `429` for the rest — **regardless of replica count** — and both
replicas must appear among the 10. Twenty successes across two replicas is the
failure this gate exists to catch.

**Evidence:**

```text
Signed: 2026-09-01 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit 4468bc4 — GREEN, first run of this gate. It was never red; it was unrunnable, because there was nothing to share.

Two API replicas on :8000 and :8001, REJOX_RATE_STORE=redis,
REJOX_RATE_UPLOAD=10. The budget was spent by the second key, which had made no
upload earlier in the run, and the upload bucket was cleared in Redis first so
the gate measured one whole window:

    API replicas running                          = 2
    requests allowed across 2 replicas (limit 10) = 10
    both replicas served                          = 5 via :8000, 5 via :8001

40 requests, 10 allowed. Per-process counters would have answered 20 — the
configured limit once per replica — which is exactly the failure this gate
exists to catch. The last line matters as much as the count: without it, "10
allowed" is also what one dead replica and one working one would produce.

Standing coverage: backend/tests/test_rate_limit_shared.py runs the same
scenario against a live Redis, with the memory store asserted as the negative
control (two limiters, 2x the ceiling) so a silent fallback to per-process
counting fails the suite. CI runs it with a Redis service.
```

---

### C3 — a run belongs to one identity and no other

**Proves:** one user cannot download another user's source code. Before plan
step 7 the only protection was that a `runId` is a `uuid4` — unguessable, but
not access control, and it travels in URLs, logs and proxy access records.

Since step 7, `guard()`'s identity is stamped on the run at creation
(`{run}/owner`) and every HTTP lookup of a run goes through one seam
(`_get_run_or_404`). The stranger's `404` here is therefore an authorization
decision, not a lucky miss.

**Command:**

Covered by `./verify-deployment.sh`, which runs it against the run it just
migrated. By hand, with two distinct keys configured and an upload from key A:

```bash
curl -s -o /dev/null -w 'owner=%{http_code}\n'    localhost:8000/api/runs/$RUN/download -H "X-API-Key: $KEY_A"
curl -s -o /dev/null -w 'stranger=%{http_code}\n' localhost:8000/api/runs/$RUN/download -H "X-API-Key: $KEY_B"
curl -s -o /dev/null -w 'job-stranger=%{http_code}\n' localhost:8000/api/jobs/$JOB     -H "X-API-Key: $KEY_B"
curl -s -o /dev/null -w 'localpath=%{http_code}\n' -X POST localhost:8000/api/parse \
     -H "X-API-Key: $KEY_A" -H 'Content-Type: application/json' -d '{"path":"/srv"}'
```

**Required output:** `owner=200`, `stranger=404`, `job-stranger=404`,
`localpath=403` — and the stranger's response body must be byte-identical in
shape to the one for a `runId` that does not exist.

`404` rather than `403` on purpose: a `403` confirms the run exists, which is
itself a disclosure to someone who should not know. The local-path check belongs
to this gate because `{"path": …}` reads a server directory the caller names,
which walks past ownership entirely — a run's source lives at a path.

**Evidence:**

```text
Signed: 2026-09-03 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit ee6df56 — re-signed after `workspace.py` changed (the B7 fix), on a tree that carries that change.

Run 33b756361c2f4a0283267622ded455b0, job 1df12266a1b940358bf60cf069f22918.

  PASS  download as the owner — 200
  PASS  download as a stranger — 404
  PASS  job as a stranger — 404
  PASS  event stream as a stranger — 404
  PASS  plan as a stranger — 404
  PASS  a run that does not exist — No such run: 00000000000000000000000000000000
  PASS  the two messages have the same shape — No such run: 33b75636…
  PASS  local-path mode is refused — 403

Someone else's run still reads exactly like a missing one — same status, same
message shape — so a 404 discloses nothing about whether the run exists.

Signed: 2026-09-01 — Ashraf (./verify-deployment.sh, Docker Desktop 29.6.2, macOS) — commit ee2991b — GREEN. The 2026-08-31 failure below is kept in place; this gate has been red once and the record stays.

Two keys configured. Run 9e7306df156e46fc8691cc036c42e55e was uploaded and
migrated to completion by ALPHA, then probed by BRAVO — a fully authenticated
caller, so what is being tested is authorization, not authentication:

    download as the owner        = 200
    download as a stranger       = 404
    job as a stranger            = 404
    event stream as a stranger   = 404
    plan as a stranger           = 404
    local-path mode is refused   = 403

And the disclosure check — a stranger's run must be indistinguishable from one
that was never created:

    stranger's run  → "No such run: 9e7306df156e46fc8691cc036c42e55e"
    absent run      → "No such run: 00000000000000000000000000000000"

Same status, same message shape. Nothing in the response answers "does this
runId exist?" for a caller not entitled to know.

Standing coverage: backend/tests/test_run_ownership.py (9 tests) runs this
shape in-process on every suite run; this signature is the live one.

---

Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4 — RED, exactly as predicted. This is now observed, not theorised.

Two keys configured (gate-key-alpha, gate-key-bravo). Run
aec3597124ea4c42a309ed7e4adb9738 was uploaded and migrated by ALPHA:

    download-as-owner(alpha)    = 200
    download-as-stranger(bravo) = 200      ← must be 404
    job-as-stranger(bravo)      = 200      ← must be 404

A second identity downloaded another identity's source code and read its job.
The only thing standing between a run and any authenticated caller is that
runIds are uuid4 — and a runId travels in URLs, browser history, proxy access
logs and support tickets. Unblocks with plan step 7.
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ OPTIONS /api/parse -H 'Origin: https://evil.example' ... | grep -ci allow-origin
0        (no access-control-allow-origin header at all)
$ OPTIONS /api/parse -H 'Origin: http://localhost:5173' ... | grep -i allow-origin
access-control-allow-origin: http://localhost:5173

The configured origin is echoed exactly; never `*`.
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
Signed: 2026-08-31 — Ashraf (verification run, Docker Desktop 29.6.2, macOS) — commit 6c504e4
$ head -c 200000000 /dev/urandom > big.zip     # 191 MiB, over the 100 MB limit
$ POST /api/upload -F file=@big.zip
http=400   (2.7s)
{"detail":"Rejected upload: archive is 200000000 bytes, over the
 104857600-byte limit."}
$ docker stats --no-stream api      (sampled every 3s through the upload)
rejox-api-1  80.53MiB / 7.749GiB     ← peak

The body is refused on its declared size rather than buffered, so the peak is
ordinary idle memory. A reverse-proxy body cap is still worth having — the bytes
do cross the wire — but this is not the single-request DoS the gate was
looking for.
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
PARTIAL — the job is green on GitHub across three consecutive pushes to
master; the required-status-check half of this gate is not in place yet.

`.github/workflows/ci.yml` job `containment` (Containment — live daemon,
section A) runs `pytest -m sandbox_live` from backend/tests/test_sandbox_live.py:
the mount is real in both directions, non-root with CapEff 0 and NoNewPrivs 1,
a read-only root, network off unless the stage asked, the pid ceiling stopping a
process storm, and a memory bomb OOM-killed at the limit with the daemon still
answering afterwards.

The workflow-level env sets REJOX_ALLOW_UNSANDBOXED=1 for every job, so this one
empties it explicitly — a containment job that inherited the opt-out would be
asserting nothing.

$ pytest -q -m sandbox_live          # macOS, Docker Desktop 29.6.2
9 passed in 15.89s

2026-09-02 — Ashraf — commit d4386e1. `Containment (live daemon — section A)`
on GitHub Actions, ubuntu-latest, three consecutive pushes to master:

$ gh run view <id> --json jobs -q '.jobs[] | select(.name|startswith("Containment"))'
  33581306641  success   https://github.com/ashrafjr-n/REJOX/actions/runs/33581306641
  33659942702  success   https://github.com/ashrafjr-n/REJOX/actions/runs/33659942702
  33660487355  success   https://github.com/ashrafjr-n/REJOX/actions/runs/33660487355

The first two of those runs failed overall — on `Backend (integration)`, an
unrelated job — which is why the evidence is per-job and not per-run. The third
is the first fully green run on master.

STILL REQUIRED TO SIGN:
  - the job marked as a required status check on master (a repository setting,
    not something this file or the workflow can assert).

    Repository state as of 2026-09-02, checked rather than assumed:

    $ gh api repos/ashrafjr-n/REJOX/branches/master/protection
      404 Branch not protected
    $ gh api repos/ashrafjr-n/REJOX/rulesets -q '.[]|{name,enforcement}'
      {"name":"master gates","enforcement":"active"}   # deletion + non_fast_forward only

    The ruleset deliberately carries no `required_status_checks` rule yet: on
    this repository that rule also rejects direct pushes to master, so turning
    it on means moving to pull requests. That is a decision taken before
    launch, not a line edited into this file — until it is taken, this gate is
    PARTIAL and says so.
```

---

### D1 — the compose deployment is exercised in CI

**Proves:** Section B re-runs on every change to compose, the queue or jobs.

**Required output:** a CI job that runs `docker compose up`, executes B1, B2 and
B5 against it, and fails the build on any of them. Paste the green run's URL.

**Evidence:**

```text
PARTIAL — the job is green on GitHub across three consecutive pushes to
master; the required-status-check half of this gate is not in place yet.

`./verify-deployment.sh` runs A0, A1, A8, A9, B0, B1, B2, B3 and B5 as one
pass, dumps the API and worker logs on any failure, and exits non-zero.
`.github/workflows/ci.yml` job `deployment` prepares /srv/rejox-data (owned by
uid 10001), derives REJOX_DOCKER_GID from the runner's socket, and runs it.

This job carries what D0 structurally cannot: D0's tests run as a process ON the
host, where every path they name is already shared with the daemon, so A1's
mismatch cannot arise there. Here a worker inside a container asks the host's
daemon to mount a path — the exact geometry that shipped broken.

2026-09-02 — Ashraf — commit d4386e1. `Deployment (docker compose — sections
B and C)` on GitHub Actions, ubuntu-latest, the same three pushes:

  33581306641  success   https://github.com/ashrafjr-n/REJOX/actions/runs/33581306641
  33659942702  success   https://github.com/ashrafjr-n/REJOX/actions/runs/33659942702
  33660487355  success   https://github.com/ashrafjr-n/REJOX/actions/runs/33660487355

STILL REQUIRED TO SIGN:
  - the job marked as a required status check on master. See the same note
    under D0: the `master gates` ruleset exists and is active, but carries only
    `deletion` and `non_fast_forward`; required status checks would also block
    direct pushes to master, and that move is deferred to pre-launch.
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

It is asked from the operator's side of the glass. The user says "job
`1df12266…` failed" and nothing more; everything else must come from what the
deployment kept. Two facts about the code make that a real question rather than
a formality, both checked rather than assumed:

- `backend/app/retention.py` is the **only** module in the backend that logs
  anything. The API, the worker, the jobs layer and every pipeline stage emit no
  application log lines at all, so the container logs hold whatever uvicorn and
  RQ happen to print and nothing Rejox chose to say.
- A job that dies with its worker (`WorkerLost`, gate B6) writes its terminal
  event from a *different* process than the one that failed. The process that
  actually knew what was happening left nothing behind by definition.

**Command:**

Two failures, deliberately of different kinds, against a running stack
(`docker compose up -d`, `H="X-API-Key: $KEY"`, `API=http://localhost:8000`).

*Case 1 — the upload is wrong.* `test-projects/broken-app` looks like a React
project and contains no React component:

```bash
( cd test-projects && zip -qr /tmp/broken.zip broken-app )
RUN=$(curl -s -X POST "$API/api/upload" -H "$H" -F "file=@/tmp/broken.zip" | jq -r .runId)
JOB=$(curl -s -X POST "$API/api/migrate" -H "$H" -H 'Content-Type: application/json' \
        -d "{\"runId\":\"$RUN\"}" | jq -r .jobId)
sleep 30
curl -s "$API/api/jobs/$JOB" -H "$H" | jq '{status, error, events: [.events[] | {stage, type}]}'
```

*Case 2 — the capacity died.* Start a migration of `test-projects/sample-app`,
wait for `running`, then `docker compose kill worker` and wait out the heartbeat
grace, exactly as in B6.

Then, for **each** job, using only what a deployment retains — not the
developer's terminal, not the pipeline source:

```bash
docker compose logs --since 30m api worker | tail -80
docker compose logs --since 30m api worker | grep -c "$JOB"
```

**Required output:** for each of the two failures, three things written into the
evidence block below, in plain sentences:

1. **Which stage failed**, and whether the container logs alone say so — or only
   `job.json` does.
2. **Why it failed**, in the words an operator would give the user.
3. **The correlation count** from the `grep -c "$JOB"` above. A zero means the
   job id a user quotes appears nowhere in the logs, so there is no way to get
   from their complaint to the lines about it.

The gate is **green** only if both failures can be explained from the retained
output alone. If the honest answer for either is "the logs do not say, only the
job's own state does", that is **red**, and the fix is structured logging
carrying the run and job id on every line — not a wider `--since`.

Record the answer even when it is unflattering. An "unknown" written down is
worth more than a green mark that nobody tested.

**Evidence:**

```text
Signed: 2026-09-03 — Ashraf (live run, Docker Desktop 29.6.2, macOS) — commit e03470c — RED, recorded as a finding rather than a pass.

Both failures were produced as specified. Both were fully described by
/api/jobs/{id}. NEITHER was described by the retained logs.

CASE 1 — the upload is wrong (broken-app), job 4f9edbdd…, run 2112bc9a…
  /api/jobs said:  {"status":"failed","error":{"type":"NothingToMigrate",
                    "stage":"analyze","message":"No React components found in
                    project 'broken-app' (9 files, 0 components, 0 routes,
                    4 dependencies)... Check that the uploaded root is the app
                    directory (not a wrapper folder), and that it contains
                    .jsx/.tsx sources."}}
  the logs said:   worker-1 | Successfully completed app.jobs.run_job(
                              '4f9edbdd…') job in 0:00:01.255977s
                   worker-1 | rejox-migrations: Job OK (4f9edbdd…)

CASE 2 — the capacity died, job 9cfe01f0…, run 6db9665b…
  /api/jobs said:  {"status":"failed","error":{"type":"WorkerLost",
                    "stage":"emit","message":"...no heartbeat for 77s, past the
                    60s grace..."}}
  the logs said:   one line, the job STARTING. Nothing about it ending. The
                   worker was killed, and the process that ruled the job lost
                   was the API, which logs nothing.

  1. Which stage failed, from the logs alone?   NO — for either case.
  2. Why, from the logs alone?                  NO — for either case.
  3. Correlation, grep -c "$JOB":               case 1: 6    case 2: 5
     Non-zero, but not a win: every one of those lines is either uvicorn's
     access log for the client's own polling (GET /api/jobs/{id} 200 OK) or
     RQ's record of dispatching the job. None reports an outcome.

  $ grep -icE "nothingtomigrate|workerlost|analyze|traceback|exception" logs
    0
  30 log lines retained in total, for two migrations and two failures.

FINDING 1 — THE LOGS DO NOT SAY. No stage, no reason, no error type, for either
class of failure. Confirmed by inspection beforehand and now observed: only
`backend/app/retention.py` logs anything; the API, the worker, the jobs layer
and every pipeline stage emit no application log lines at all.

FINDING 2 — WORSE, THE LOGS SAY THE OPPOSITE. For case 1, RQ reported
"Successfully completed" and "Job OK" for a migration that FAILED. This is a
direct consequence of a deliberate design decision documented in
`app/jobs.py`: `run_job` "never raises — every failure becomes a terminal
`failed` event". RQ sees a clean return and reports success. So an operator
grepping the worker logs for trouble finds a green line for a failed job, which
is worse than silence: silence prompts a question, "Job OK" ends one.

An operator handed only a job id today can learn nothing about why it failed
without querying the API for that specific job. There is no path from a
complaint to a cause, and no way to notice a rising failure rate at all.

FINDING 2 IS FIXED — 2026-09-03, commit V3.4, verified live on the same
fixture. `run_job` now raises `MigrationFailed` AFTER writing the terminal
event, so the runner's record agrees with the job's:

  $ docker compose logs worker | grep 2054981333ce459bb8a15fd6bc7d3d3f
    rejox-migrations: app.jobs.run_job('2054981333ce…')
    [Job 2054981333ce…]: exception raised while executing (app.jobs.run_job)
    app.jobs.MigrationFailed: 2054981333ce… failed during analyze —
    NothingToMigrate: No React components found in project 'broken-app' …
  $ docker compose logs worker | grep -cE "Successfully completed.*JOB|Job OK"
    0

The green line for a failed job is gone, and what replaced it names the stage
and the reason. The event stream is untouched: the terminal event is written
first and never depends on that raise. Split out and fixed on its own because
it lives entirely in `app/jobs.py` — it does not touch `app/main.py`, so it does
not re-red section C.

FINDING 1 IS STILL OPEN, and this gate stays RED for it. There is still no
run/job-keyed structured logging, no stage boundary is logged, and case 2 —
`WorkerLost` — still produces no log line about the job ending at all, because
the process that rules a job lost is the API, which logs nothing. Deferred
deliberately to be done with the session/auth work: both touch `app/main.py` and
both re-red all of section C, so one pass means one re-signing round instead of
two.

TO SIGN, this gate must be re-run and both cases explained from the retained
logs alone. Case 1 would pass that today. Case 2 would not.


test-projects/broken-app was added 2026-09-03 for this gate, with
backend/tests/test_broken_fixture.py pinning it: it asserts the fixture still
looks like a React project AND still holds zero components, so the day someone
"fixes" it the test fails instead of the gate silently asserting nothing.

Verified locally at that commit, on the host rather than through the API:
  $ build_knowledge_graph(test-projects/broken-app)
    parsed: 9 files, 0 components
  $ analyze_graph(kg)
    NothingToMigrate: No React components found in project 'broken-app'
    (9 files, 0 components, 0 routes, 4 dependencies). Rejox migrates React
    components to React Native; there is nothing here to score or migrate.
    Check that the uploaded root is the app directory (not a wrapper folder),
    and that it contains .jsx/.tsx sources.

That is the pipeline refusing on content, at a named stage — NOT a parse
failure. Worth stating because the obvious way to build this fixture, a file
with a syntax error, does not work: the parser skips unparseable files and the
migration succeeds anyway (tried, 2026-09-03).

This says nothing yet about what the DEPLOYMENT retains, which is the only
question E0 actually asks.
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
| A — Containment | 10 | **10 / 10** | yes — absolute |
| B — Deployment | 8 | **7 / 8** (B6 red) | yes |
| C — HTTP surface | 6 | **6 / 6** | yes |
| D — CI | 2 | 0 / 2 (both written, neither run in CI) | yes |
| E — Operability | 3 | 0 / 3 | answers required, fixes negotiable |

Outstanding before launch, in the order the plan takes them:

1. **B6** — decide what a job means when its worker dies: re-queue it, fail it,
   or document it. Red, live.
2. **D0 / D1** — the jobs are written and green locally; they need one run on
   GitHub and to be made required status checks on master.
3. **E0 – E2** — answers, not necessarily fixes.

Closed on 2026-09-01, both signed live:

- **C3** — a run records its owner and every HTTP lookup enforces it (step 7).
- **C2** — rate-limit counters moved to Redis, proven across two replicas
  (step 6). Section **C** is now complete.

```text
Launch authorised by: ____________________  date: __________
Commit signed off:    ____________________
```
