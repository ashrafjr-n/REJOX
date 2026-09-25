"""Upload/ingest stage schemas — the pipeline's front door.

The engine downstream of here works from a local filesystem path, but the
*product* starts from a user upload (a ZIP or a public GitHub URL). Ingestion
lands that untrusted input in an isolated run workspace and reports what it
found: where the files are, which directory is the actual React project root
(an archive may wrap everything in a folder, or the app may live in a monorepo
subdirectory), and how big the payload was.

All fields are structured so the API can return this verbatim and the next
stage (`build_knowledge_graph`) can run against ``detectedRoot`` without any
re-derivation.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CandidateRoot(BaseModel):
    """A directory in the landed tree that looks like a React project root.

    ``path`` is relative to :attr:`IngestedProject.rootPath` (``"."`` when the
    project sits at the top of the extract). ``reactVersion`` is the version
    range declared for ``react`` in that ``package.json`` — the signal that
    makes this a React project and not just any Node package.
    """

    model_config = ConfigDict(extra="forbid")

    path: str
    packageName: str
    reactVersion: str


class IngestedProject(BaseModel):
    """The result of landing an upload into a run workspace.

    ``detectedRoot`` is the absolute path the rest of the pipeline should treat
    as the project root; ``candidateRoots`` lists every React project found so
    the caller can override the choice in a monorepo with more than one app.
    """

    model_config = ConfigDict(extra="forbid")

    runId: str
    rootPath: str
    source: Literal["zip", "github"]
    detectedRoot: str
    candidateRoots: list[CandidateRoot] = Field(default_factory=list)
    fileCount: int
    sizeBytes: int
    warnings: list[str] = Field(default_factory=list)
