# Deploying Rejox

Self-hosting the Rejox web service: the API, the job queue and the sandboxed
workers. The CLI needs none of this — see the [README](../README.md).

```bash
cp .env.example .env     # set a credential, a session secret and GEMINI_API_KEY

# Run workspaces live on the host and are bind-mounted at the SAME path inside
# the containers — see below for why that is not optional. 10001 is the uid the
# image runs as.
sudo mkdir -p /srv/rejox-data && sudo chown -R 10001:10001 /srv/rejox-data
echo 'REJOX_DATA_DIR=/srv/rejox-data' >> .env

# The worker needs the group that owns the Docker socket, or it cannot start a
# sandbox container. On Docker Desktop the socket is root:root, so this is 0.
echo "REJOX_DOCKER_GID=$(stat -c '%g' /var/run/docker.sock 2>/dev/null || echo 0)" >> .env
```

**On Docker Desktop (macOS), the two lines above are different.** Both defaults
are Linux ones and both fail there — see the 2026-09-05 entry in
[`docs/PRE-LAUNCH-CHECKLIST.md`](PRE-LAUNCH-CHECKLIST.md) for the evidence:

```bash
# /srv is not a shared path, and the chown is what breaks it: under VirtioFS the
# host-side access check runs as the macOS user, so a root owned by 10001 is
# unwritable by every uid in the container — root included. Leave it yours.
sudo mkdir -p /Users/Shared/rejox-data
sudo chown -R "$(id -u):$(id -g)" /Users/Shared/rejox-data
echo 'REJOX_DATA_DIR=/Users/Shared/rejox-data' >> .env

# `stat -f %g` (the macOS spelling) reads the SYMLINK, not the socket, and
# answers 1. What counts is what the container sees: root:root 0660.
echo 'REJOX_DOCKER_GID=0' >> .env

docker compose up --build
```

Three services, and the split is the architecture:

| Service | Role |
| --- | --- |
| `redis` | the durable queue — a migration outlives an API restart because the job lives here, not in a thread inside the API |
| `api` | accepts uploads, analyses, plans, enqueues. Never runs a migration. Owns the retention sweeper. |
| `worker` | runs migrations. `docker compose up --scale worker=3` for more capacity. |

The image carries both runtimes (Python for the pipeline, Node for the
`parser-worker` / `codemod-worker` subprocesses) but **not** the toolchain for
validating a migrated project — that runs in a throw-away sandbox container per
stage (`REJOX_SANDBOX=docker`).

**Why `REJOX_DATA_DIR` is a bind mount and not a named volume.** That sandbox
container is a *sibling*: the worker asks the host's daemon for it, so the
`-v {run dir}:/work` it requests is resolved against the **host's** filesystem
while the path came from inside the worker's container. If those two disagree,
Docker does not fail — it creates an empty directory of that name and mounts
that, and every stage then validates nothing and reports success. Mounting the
workspace root at an identical path on both sides keeps them in agreement; the
sandbox also proves the mount with a canary before running anything, so a
misconfiguration is an error rather than a green run against an empty folder.

Two things the deployment refuses to run without: a credential, and real
containment. The worker checks the same sandbox refusal the API does, so a
misconfigured worker cannot become an un-sandboxed hole behind a correct front
door. **Read [`docs/SECURITY.md`](SECURITY.md) first** — including what the
worker's Docker socket mount actually grants.

**Signing in.** There are two credentials, because the two clients cannot share
one. A CLI or CI job sends an API key (`REJOX_API_KEYS`) as `X-API-Key` or
`Authorization: Bearer`. A browser exchanges an invite code
(`REJOX_INVITE_CODES`) at `POST /api/session` for an httpOnly, `Secure`,
`SameSite=Lax` cookie signed with `REJOX_SESSION_SECRET` — which has no default,
so set it. The browser needs a cookie rather than a header because two of the
surfaces it uses, the migration event stream (`EventSource`) and the project
download (a link), cannot send a header at all.

`SameSite=Lax` is what keeps CSRF off this surface without a token, and it works
because the app and the API are served from **one origin**: the dev server
proxies `/api` to the backend, and a production deployment puts a reverse proxy
in the same shape. Serving them on separate origins is not supported.

**Ownership.** A run belongs to the identity that created it — the *account*
behind a session, not the session, so signing out and back in does not orphan
your runs. Its uploads, its job, and its download answer `404` — not `403`,
which would confirm the run exists — to every other caller, so one user cannot
read another's source code by learning a `runId`.

**Storage.** `REJOX_ACCOUNT_QUOTA_BYTES` (2 GB) bounds what one identity can
occupy across all its runs, and `REJOX_MIN_FREE_BYTES` stops the server taking
uploads it has no room to finish. Over quota answers `413` and says the runs
expire; a full disk answers `503` and says it is the server's problem.

**Logs.** One JSON line per event — stage boundaries, terminal results, HTTP
requests — each carrying the run id, job id and the caller's identity digest, so
a job id a user quotes leads straight to the lines about it. `REJOX_LOG_FORMAT=text`
for a readable terminal format. Credentials are never logged.

**Retention.** A run workspace holds an uploaded project and the React Native
project emitted from it, so it is deleted after `REJOX_RUN_TTL_SECONDS` (24h
default). The API sweeps hourly; to drive it from cron instead, set
`REJOX_RETENTION=off` and schedule `rejox sweep` (`--dry-run` lists what would go).

**When a worker dies.** The migration is lost — nothing re-queues it — but the
job does not go quiet. The process running a migration heartbeats into its job
file every `REJOX_JOB_HEARTBEAT` seconds (10 by default), and a job left
`running` with no beat for `REJOX_JOB_HEARTBEAT_GRACE` seconds (60) is reported
as a terminal `WorkerLost` failure, so a client is told to start again instead
of polling forever. Widen the grace on a slow or heavily contended host.

**Scaling, honestly.** Workers scale freely — they sit behind the queue. So does
the API, now that rate-limit counters live in Redis (`REJOX_RATE_STORE=redis`,
which compose sets): the budget is the fleet's, not one per container. Scaling
the API past one replica also needs a reverse proxy in front of it — the base
compose file publishes a single fixed host port.

**Verify the deployment, don't assume it.**

```bash
REJOX_DATA_DIR=/srv/rejox-data \
REJOX_DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)" \
  ./verify-deployment.sh

# Docker Desktop / macOS — see the note under Deploying:
#   REJOX_DATA_DIR=/Users/Shared/rejox-data REJOX_DOCKER_GID=0 ./verify-deployment.sh
```

Stands the whole stack up and asserts what only a real run can: that the worker
reaches the daemon, that a sandbox container is handed the *right* directory,
that a migration crosses the queue into another process and comes back
downloadable, that an uploaded `postinstall` and a URL dependency spec are both
dropped from the emitted project, and that a dead Redis is a clean 503 rather
than a quiet in-process fallback. It exits non-zero on the first failure and
dumps the service logs. CI runs it on every push (the `deployment` job), next to
`pytest -m sandbox_live`, which asserts the container's own limits against a
live daemon (the `containment` job).

**Before you point this at other people's code**, read
[`PRE-LAUNCH-CHECKLIST.md`](PRE-LAUNCH-CHECKLIST.md): every gate, the exact
command, the output it must produce, and what has actually been signed — and the
known gaps in [`SECURITY.md`](SECURITY.md), which are stated there plainly.
