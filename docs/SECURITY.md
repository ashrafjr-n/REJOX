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

`direct` mode runs commands as the Rejox process. It is a development
convenience and is **not a sandbox**; the code says so, and `/api/migrate`
refuses to start in that mode unless `REJOX_ALLOW_UNSANDBOXED=1` is set
deliberately. Docker mode never silently degrades: if the daemon is missing, the
run fails rather than falling back.

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

- **Identity**: a shared API key (`Authorization: Bearer` or `X-API-Key`) from
  `REJOX_API_KEYS`, compared as digests in constant time. With no keys
  configured the API returns **503 and says so** rather than serving everyone;
  `REJOX_ALLOW_ANONYMOUS=1` opts a dev machine out.
- **Budgets**: fixed-window per-identity limits, separate per bucket, strictest
  on the stages that cost money (`migrate`) or CPU (`upload`, `pipeline`).
- **Concurrency**: `REJOX_MAX_CONCURRENT_MIGRATIONS` caps simultaneous
  migrations, counted from live worker threads so a wedged job cannot block the
  endpoint forever.
- CORS origins are explicit; there is no wildcard fallback.

## What is NOT contained — known gaps

Stated plainly, because a security document that only lists wins is marketing:

- **Rate limits are per API process.** Behind more than one API container each
  enforces its own share of the limit, so the effective ceiling is the limit
  times the number of API replicas. A shared store is the fix; until then run
  one API container (migration *workers* scale freely — they are behind the
  queue, not the rate limiter).
- **A shared API key is not user accounts.** There is no per-user isolation,
  quota, or audit trail; every holder of a key is the same principal.
- **Run workspaces are deleted on a TTL, but are not encrypted at rest.**
  `REJOX_RUN_TTL_SECONDS` (24h default) is enforced by a sweeper the API starts
  and by `rejox sweep` for cron-driven deployments. What remains open: the data
  sits unencrypted on the shared volume for the length of that window, and
  nothing verifies a deletion actually completed.
- **The container image is not pinned by digest** by default. Pin
  `REJOX_SANDBOX_IMAGE` to a digest in production.
- **`ingest_github` clones a URL the caller supplies.** The clone itself is
  shallow and unauthenticated, but it is outbound traffic the caller controls.
- **Docker mode has not been exercised against a live daemon in this
  repository's test runs.** The container flags are unit-tested from
  `docker_argv`; the end-to-end path needs verification on a host with Docker
  running before it is trusted in production.

## Minimum production configuration

```bash
REJOX_SANDBOX=docker
REJOX_SANDBOX_IMAGE=node:20-bookworm-slim@sha256:<pin>
REJOX_API_KEYS=<generated-key>
REJOX_CORS_ORIGINS=https://your-frontend.example
# and NOT set: REJOX_ALLOW_ANONYMOUS, REJOX_ALLOW_UNSANDBOXED,
#              REJOX_NPM_ALLOW_SCRIPTS
```

Run one API container and as many `rejox-worker` containers as the box can take
(`docker compose up --scale worker=N`). Put a reverse proxy in front for TLS and
a request-body cap.

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
