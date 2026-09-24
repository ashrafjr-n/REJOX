# Rejox backend — API and worker share one image.
#
# The image carries both runtimes on purpose: the pipeline is Python, but the
# Project Intelligence Engine and the Deterministic Transformer are Node workers
# (`parser-worker`, `codemod-worker`) invoked as subprocesses. An image with only
# Python would build fine and fail at the first parse.
#
# It does NOT carry the toolchain for validating a migrated project. That work —
# `npm install`, `tsc`, Metro against an uploaded project — runs in a separate,
# throw-away container (REJOX_SANDBOX=docker), never in this one. See
# docs/SECURITY.md.

# --- Wheel: the same artifact a user installs ---------------------------------
# Building the wheel runs hatch_build.py, which bundles both Node workers into
# rejox/_workers/ with esbuild. So this stage needs Python and Node; the
# runtime stage gets one self-contained wheel and no node_modules at all.
FROM python:3.12-slim-bookworm AS wheel
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:20-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /build

# Worker dependencies first, so a source-only change does not reinstall them
# (the build hook skips `npm ci` when node_modules is already there).
COPY parser-worker/package.json parser-worker/package-lock.json ./parser-worker/
RUN cd parser-worker && npm ci --no-audit --no-fund --ignore-scripts
COPY codemod-worker/package.json codemod-worker/package-lock.json ./codemod-worker/
RUN cd codemod-worker && npm ci --no-audit --no-fund --ignore-scripts

COPY pyproject.toml hatch_build.py LICENSE ./
COPY scripts/bundle_workers.py ./scripts/
COPY parser-worker/ ./parser-worker/
COPY codemod-worker/ ./codemod-worker/
COPY src/ ./src/
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /wheels .


# --- Runtime ------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

# Node to run the two worker bundles; the docker CLI so the sandbox can start sibling
# containers through a mounted socket. No build toolchain in the final image.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends \
        nodejs docker-ce-cli \
    && apt-get purge -y gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    REJOX_WORKSPACE_ROOT=/data/workspaces \
    REJOX_AI_CACHE=/data/rejox-ai-cache.sqlite3

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=wheel /wheels/ /tmp/wheels/
RUN pip install --no-cache-dir --no-deps /tmp/wheels/*.whl && rm -rf /tmp/wheels

# Non-root. The workspace volume is chowned so uploads and emitted projects are
# writable without granting the process any privilege it does not need.
RUN useradd --create-home --uid 10001 rejox \
    && mkdir -p /data/workspaces \
    && chown -R rejox:rejox /data /app
USER rejox

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4).status==200 else 1)"

# One worker process by default: a migration is CPU- and IO-heavy, and the
# rate-limit and thread-backend job state are per process (see docs/SECURITY.md).
# Scale by running more API containers behind a proxy, and more `rejox-worker`
# containers behind Redis.
CMD ["uvicorn", "rejox.server.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
