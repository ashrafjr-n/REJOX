"""Migration worker — the process that actually runs queued migrations.

    rejox-worker            # consume the queue until stopped

Run one or more of these alongside the API when ``REJOX_QUEUE=rq``. Each worker
executes ``app.jobs.run_job`` for one migration at a time, so the fleet's
capacity is simply how many workers you run — and a worker that dies mid-job
returns that job to the queue rather than losing it.

A worker needs the same environment the API has: the run workspace (so it can
read the uploaded source and write ``job.json``), the sandbox configuration (it
is the process that executes the uploaded project's toolchain), and the AI
provider settings. In a container deployment that means the API and the workers
share the workspace volume.
"""

from __future__ import annotations

import sys

from app import queue
from app.pipeline.sandbox import SandboxError, SandboxPolicy, assert_safe_for_untrusted_input


def main() -> int:
    """Start an RQ worker on the migrations queue. Blocks until interrupted."""
    try:
        from rq import Worker  # noqa: PLC0415
    except ImportError:
        print(
            "rejox-worker needs the `rq` package. Install it, or run the API "
            "with REJOX_QUEUE=thread (no worker process needed).",
            file=sys.stderr,
        )
        return 1

    if queue.backend() != "rq":
        print(
            f"REJOX_QUEUE={queue.backend()!r}: there is no queue for a worker to "
            "consume. Set REJOX_QUEUE=rq (and REJOX_REDIS_URL) to run workers.",
            file=sys.stderr,
        )
        return 1

    # The worker — not the API — is the process that executes an uploaded
    # project's `npm install`, tsc and Metro. It therefore enforces the same
    # refusal the API does, so a misconfigured worker cannot become the
    # un-sandboxed hole behind a correctly-configured front door.
    try:
        assert_safe_for_untrusted_input()
    except SandboxError as exc:
        print(f"Refusing to start: {exc}", file=sys.stderr)
        return 1

    policy = SandboxPolicy.from_env()
    q = queue.get_queue()
    print(
        f"rejox-worker → queue {q.name!r} at {queue.redis_url()} "
        f"(sandbox: {policy.mode})",
        file=sys.stderr,
    )
    Worker([q], connection=q.connection).work(with_scheduler=False)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
