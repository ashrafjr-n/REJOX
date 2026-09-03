# Security model

Rejox accepts a codebase from a stranger and then runs that codebase's
toolchain. That is the whole product, and it is also the whole risk: validating
a migration means `npm install`, `tsc` and Metro executing against files an
uploader chose. This document states what is contained, what is not, and what an
operator must configure before pointing this at the internet.

## Threat model

The uploader is untrusted. They control:

- every file in the archive (paths, contents, symlinks),
- the source `package.json` — dependency names *and* version specs,
- how many requests they send and how large each one is.

They must not be able to execute code on the host, read anything outside their
own run, exhaust the box, or spend the operator's LLM quota without limit.

## What is contained

### 1. Ingest — before anything runs

`app/pipeline/ingest.py` rejects the archive itself:

| Guard | Limit |
| --- | --- |
| Compressed size | `REJOX_MAX_ARCHIVE_BYTES` (100 MB) |
| Expanded size | `REJOX_MAX_UNCOMPRESSED_BYTES` (500 MB) |
| File count | `REJOX_MAX_FILE_COUNT` (20 000) |
| Path traversal | entries resolving outside the run root are refused |
| Symlinks | targets resolving outside the run root are refused |

### 2. Execution — the sandbox

Every external command the Validator runs goes through `app/pipeline/sandbox.py`
and nowhere else. In `docker` mode each one runs in a throw-away container:

- `--cap-drop ALL`, `--security-opt no-new-privileges`, non-root `--user`
- `--memory` / `--memory-swap` (a real ceiling, not a soft one), `--cpus`,
  `--pids-limit`
- `--read-only` root; the run directory is the only writable mount
- **network only for `npm install`** — typecheck and bundle run with
  `--network none`
- a wall-clock timeout on every stage

Every one of those was verified against a live daemon on 2026-08-31 — non-root
and zero capabilities, a read-only root, `--network none` for typecheck and
bundle, a fork storm stopped at the pid ceiling, and a memory bomb OOM-killed at
the limit with the host unaffected. See section A of
[`PRE-LAUNCH-CHECKLIST.md`](PRE-LAUNCH-CHECKLIST.md) for the commands and the
output each produced.

`direct` mode runs commands as the Rejox process. It is a development
convenience and is **not a sandbox**; the code says so, and `/api/migrate`
refuses to start in that mode unless `REJOX_ALLOW_UNSANDBOXED=1` is set
deliberately. Docker mode never silently degrades: if the daemon is missing, the
run fails rather than falling back.

**The mount is proven, not assumed.** A sandbox container is a *sibling*,
started by the daemon that owns the socket, so `-v {run dir}:/work` is resolved
against that daemon's filesystem — the host's — while the path came from inside
the worker's own container. When the two disagree Docker does not fail: it
creates an empty directory of that name and mounts it, and every stage then
runs against nothing while reporting success. That is a wrong answer wearing a
green badge, so before the first command in a run directory the sandbox writes
a token there and reads it back from inside a container; a mismatch raises
`SandboxError`. The deployment avoids the situation in the first place by
bind-mounting the workspace root at an identical path on both sides
(`REJOX_DATA_DIR`), and the check is what stops a future deployment from
reintroducing it quietly.

### 3. Dependencies — what may be installed

- `npm install --ignore-scripts`. Lifecycle scripts (`preinstall`,
  `postinstall`) are arbitrary code from a tree the uploader influences, and
  Rejox only needs the package *files* to typecheck and bundle. Verified: the
  Expo 52 toolchain installs, type-checks and bundles cleanly without them.
- Only two source dependencies carry over at all (`zustand`, `axios`), and only
  when the version is a plain registry range. A `https://…tgz`, `git+ssh://…`,
  `file:…`, `github:…` or `npm:…` spec is dropped, so `npm install` can never be
  pointed at a source of the uploader's choosing.

### 4. HTTP — who may spend what

`app/security.py`:

- **Identity**: two credentials, because the two clients cannot use the same
  one. `key:<digest>` from a shared API key (`Authorization: Bearer` or
  `X-API-Key`, from `REJOX_API_KEYS`) for CLI and CI. `acct:<digest>` from a
  browser session cookie minted from an invite code (`REJOX_INVITE_CODES`, see
  `app/sessions.py`). Both compared as digests in constant time. With neither
  configured the API returns **503 and says so** rather than serving everyone;
  `REJOX_ALLOW_ANONYMOUS=1` opts a dev machine out. The header is consulted
  first: a caller that presented a key meant to act as that key, and a stray
  cookie must not silently override it.
- **A session carries an account, never a session id.** The identity is derived
  from the invite code, so it is stable across signing out and back in. This is
  not a detail: the identity string is what `{run}/owner` stores and what the
  rate limiter counts, so a per-session identity would orphan every run its
  owner had on logout and hand them a fresh budget on login.
- **The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`**, signed with
  HMAC-SHA256 over `{account, iat, exp}`. `REJOX_SESSION_SECRET` has no default:
  a shared fallback would let anyone mint a session for any deployment. `Lax`
  rather than `None` is what keeps CSRF off this surface without a token, and it
  works because the browser app and the API are served from **one origin** — the
  Vite dev server proxies `/api`, and a production deployment puts a reverse
  proxy in the same shape. Serving them on separate origins would require
  `SameSite=None` plus credentialed CORS, and is not supported.
- **No session store.** Nothing is kept server-side; the cookie is self-
  describing and signed. Revocation is per *account* and immediate: every
  request re-checks that the account still matches a configured invite code, so
  removing a code kills its sessions on the next request. What this does not
  offer is revoking one session while leaving that account's others alive — a
  trade taken deliberately rather than adding a second Redis-backed seam.
- **Storage ceilings** (gate E1). `REJOX_ACCOUNT_QUOTA_BYTES` bounds one
  identity's total footprint across all its runs, checked on upload;
  `REJOX_MIN_FREE_BYTES` refuses uploads while the volume is nearly full. They
  answer different problems and say so differently: over quota is **413** (your
  runs, and they expire), low disk is **503** (the server's problem, and nothing
  you do helps).

  *Known cosmetic issue:* those messages render sizes as GB to one decimal
  place, so a quota configured well below 1 GB reads as "0.0 GB of 0.0 GB". The
  numbers are correct at the shipped default and anywhere near it; only an
  unusually small `REJOX_ACCOUNT_QUOTA_BYTES` makes the text unhelpful. Left
  alone deliberately: the fix is one format string in `app/security.py`, and by
  the re-signing table any change there re-reds all of section **C**, which is
  three verification passes for a rounding artifact.

  The 2 GB default, so it can be recomputed rather than believed: a VALIDATED
  run keeps the node_modules its `npm install` produced inside the run
  workspace, measured at 391 MB for test-projects/sample-app (2026-09-03,
  macOS) — so 2 GB is roughly 5 validated runs held at once, not 50. Gate B7's
  ~40 MB/run is unvalidated gate traffic, which retains no install and is a
  floor, not the typical case; raise this default before a day of real
  uploads that exercise validation. The ceiling exists because the other two
  limits do not compose: the rate limit caps requests (10 uploads/minute) and
  the archive guard caps a single upload (500 MB expanded), and 10 x 500 MB is
  300 GB/hour held for a 24h retention window. Change either input and this
  number should be recomputed.
- **Budgets**: fixed-window per-identity limits, separate per bucket, strictest
  on the stages that cost money (`migrate`) or CPU (`upload`, `pipeline`).
- **Where the counters live** is one setting, `REJOX_RATE_STORE`. `memory`
  (default) counts in the API process — correct for a single container, and
  N times the configured ceiling behind N replicas. `redis` counts in the Redis
  the queue already uses, so the limit is the fleet's. A shared store that
  cannot be reached answers **503**; it never falls back to counting locally,
  because that would restore the per-replica ceiling and look like a working
  server. Compose sets `redis`. The cost of that choice, stated plainly: on the
  compose deployment Redis becomes a hard dependency of the *whole*
  authenticated surface, not just of `/api/migrate` — if Redis is down, every
  guarded endpoint answers 503, because the limiter runs before the handler.
- **Concurrency**: `REJOX_MAX_CONCURRENT_MIGRATIONS` caps simultaneous
  migrations, counted from live worker threads so a wedged job cannot block the
  endpoint forever.
- CORS origins are explicit; there is no wildcard fallback.

### 5. Ownership — whose run is whose

`app/main.py` + `app/pipeline/workspace.py`:

- **A run belongs to exactly one identity.** The identity `guard()` establishes
  is stamped on the run at creation, into `{run}/owner` — a file, because the
  API process that creates a run is not the worker process that executes it.
  Written once; a run never changes hands.
- **Every lookup goes through one seam.** `_get_run_or_404()` resolves a run
  *and* checks the owner, so ownership is enforced in one place rather than
  remembered at each endpoint. A job is not separately owned: it reports on a
  run, so it is readable by whoever the run is readable by.
- **A stranger's run is indistinguishable from a run that does not exist** —
  same `404`, same message. A `403` would confirm the run exists, which is
  itself a disclosure to someone who should not know.
- **Unowned fails closed.** A run created without an identity (the CLI, which
  has none) is owned by nobody and is unreachable over HTTP — never public.
- **Local-path mode is off by default.** `{"path": …}` reads a server directory
  the caller chooses, which walks straight past ownership because a run's source
  lives at a path. It is refused with `403` unless
  `REJOX_ALLOW_LOCAL_PATH=1` is set for a developer machine.

Enforced by `tests/test_run_ownership.py` and gate C3 in
[`PRE-LAUNCH-CHECKLIST.md`](PRE-LAUNCH-CHECKLIST.md).

## What is NOT contained — known gaps

Stated plainly, because a security document that only lists wins is marketing:

- **Rate limits are only shared where `REJOX_RATE_STORE=redis`.** Compose sets
  it, so the documented deployment is correct. A hand-rolled deployment that
  leaves the default `memory` and runs more than one API container gets the
  configured limit *per container* — the ceiling multiplies, silently. What
  remains open even on `redis`: the window is fixed, not sliding, so an identity
  can spend a full budget at the end of one window and another at the start of
  the next; and the limit is per API key, so everyone sharing a key shares it.
- **A shared API key is still not user accounts.** Runs now have an owner (see
  *Ownership* above), so one key holder can no longer read another's run — the
  hole verified live on 2026-08-31, when a second key received `200` for another
  key's run, is closed. What remains: an identity is a *key*, not a person, so
  everyone sharing a key shares its runs; there is no per-user quota and no
  audit trail; and revoking a key orphans its runs rather than reassigning them
  (they become unreachable and are reaped on the TTL).
- **Run workspaces are deleted on a TTL, but are not encrypted at rest.**
  `REJOX_RUN_TTL_SECONDS` (24h default) is enforced by a sweeper the API starts
  and by `rejox sweep` for cron-driven deployments. What remains open: the data
  sits unencrypted on the shared volume for the length of that window, and
  nothing verifies a deletion actually completed.
- **The container image is not pinned by digest** by default. Pin
  `REJOX_SANDBOX_IMAGE` to a digest in production.
- **`ingest_github` clones a URL the caller supplies.** The clone itself is
  shallow and unauthenticated, but it is outbound traffic the caller controls.
- **A job whose worker dies is lost — reported, not recovered.** The migration
  itself is not resumed or re-queued: RQ holds the execution as `started` and
  nothing picks it back up. What was fixed (2026-09-02) is the silence around
  it. The process executing a job stamps a heartbeat into `job.json` every
  `REJOX_JOB_HEARTBEAT` seconds; a reader that finds a `running` job with no
  beat for `REJOX_JOB_HEARTBEAT_GRACE` seconds writes a terminal `failed` event
  (`WorkerLost`) instead of serving `running` for ever. The remaining trade-off
  is the mirror of it: a live worker frozen longer than the grace is declared
  lost, and resurrects if it thaws — widen the grace on a contended host. The
  wedge as originally observed (2026-08-31) is recorded under B6 in
  [`PRE-LAUNCH-CHECKLIST.md`](PRE-LAUNCH-CHECKLIST.md), which is signed green as
  of 2026-09-03: against a live daemon, a killed worker's job reported `failed`
  with `WorkerLost` past the grace, while RQ still held the execution as
  `started` — lost, and said so.
- **A failed migration is under-reported in the logs — but no longer
  mis-reported.** Gate E0 (2026-09-03) found two separate defects here, and they
  are at different stages of repair. Keeping them apart matters: one was a lie,
  the other is a silence, and only the lie is fixed.

  *Fixed — a failed job written down as a success.* `run_job` catches every
  failure to guarantee a terminal event, and used to return cleanly afterwards,
  so RQ logged `Successfully completed` / `Job OK` for migrations that had
  failed. An operator scanning the worker log for trouble found a green line.
  Since 2026-09-03 `run_job` raises `MigrationFailed` **after** writing the
  terminal event, so the worker's record agrees with the job's and names the
  stage and reason:
  `app.jobs.MigrationFailed: <job> failed during analyze — NothingToMigrate: …`.
  The event stream never depends on that raise, and the `thread` backend
  swallows it (there is no second record to correct in-process).

  *Also fixed — a failure nothing logged at all.* `app/logs.py` now emits one
  JSON line per event, carrying the run id, job id and the caller's identity
  digest, bound through `contextvars` so every stage carries them without being
  handed them. Lines are written at each stage boundary, at every terminal
  event, at each HTTP request, and — the case that had nothing at all — when the
  API's reconciler rules a job `WorkerLost`, which is the only party still alive
  to say so. Identity is logged as the same `key:`/`acct:` digest `{run}/owner`
  holds, so a log line joins to a run's owner; a raw key or invite code is never
  written. Verified against a live deployment on 2026-09-03 and gate E0 is
  signed green: a killed worker's job was explained from the container logs
  alone, from an `api-1` line naming the run, the job, the stage and the grace
  it missed — the case that previously produced no log line at all.
- **Retention has no notion of an in-flight run.** The sweeper reaps by age
  alone, so a short `REJOX_RUN_TTL_SECONDS` and a long migration can delete a
  workspace out from under a running job. Harmless at the 24h default.

## Minimum production configuration

```bash
REJOX_SANDBOX=docker
REJOX_SANDBOX_IMAGE=node:20-bookworm-slim@sha256:<pin>
REJOX_API_KEYS=<generated-key>
REJOX_CORS_ORIGINS=https://your-frontend.example
# and NOT set: REJOX_ALLOW_ANONYMOUS, REJOX_ALLOW_UNSANDBOXED,
#              REJOX_NPM_ALLOW_SCRIPTS, REJOX_ALLOW_LOCAL_PATH
```

Run as many `rejox-worker` containers as the box can take
(`docker compose up --scale worker=N`). Put a reverse proxy in front for TLS and
a request-body cap. The API scales too — its budgets are shared through Redis —
but past one replica the proxy has to be the thing publishing the port, since
the base compose file maps a single fixed one.

The workspace root must be a bind mount at an **identical path** on the host and
inside the containers (`REJOX_DATA_DIR`), for the reason given under *the mount
is proven, not assumed* above. Create it before the first `docker compose up`,
owned by the image's `rejox` uid:

```bash
sudo mkdir -p /srv/rejox-data && sudo chown -R 10001:10001 /srv/rejox-data
```

The worker also needs the gid that owns `/var/run/docker.sock` (`REJOX_DOCKER_GID`;
`stat -c '%g' /var/run/docker.sock` on Linux, `0` on Docker Desktop). The socket
is mode 0660 and the image is non-root, so without it every migration fails at
the first stage with `permission denied ... docker.sock`.

**The worker's Docker socket.** In the compose deployment the worker mounts
`/var/run/docker.sock` so the Validator can start a sandbox container per stage.
That mount grants the worker control of the host's Docker daemon — effectively
host root. It is the deliberate trade that makes containment possible at all,
and it is why the worker runs nothing but queued migrations and exposes no
ports. On a host where that trade is unacceptable, run the workers on a
dedicated node, or use a rootless/nested Docker daemon instead of the host's.

## Reporting

Security issues should go to the maintainer privately rather than a public
issue.
