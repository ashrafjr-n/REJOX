"""`test-projects/broken-app` must keep failing — gate E0 depends on it.

A fixture whose job is to fail is the easiest thing in a repository to break by
accident: add one component to it and it quietly starts succeeding, and the gate
that uses it goes on reporting green while asserting nothing. This pins the two
properties E0 actually needs — that it looks like a React project, and that the
pipeline refuses it at a NAMED stage with a message that says what to do.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.pipeline.analyzer import NothingToMigrate, analyze_graph
from app.pipeline.intelligence import build_knowledge_graph

REPO_ROOT = Path(__file__).resolve().parents[2]
BROKEN = REPO_ROOT / "test-projects" / "broken-app"


def test_the_fixture_still_looks_like_a_react_project() -> None:
    """If it stopped looking like one, the gate would be proving nothing: a
    directory that is obviously not React is refused for the wrong reason."""
    pkg = json.loads((BROKEN / "package.json").read_text())
    assert "react" in pkg["dependencies"]
    assert "react-dom" in pkg["dependencies"]
    assert (BROKEN / "index.html").is_file()
    assert (BROKEN / "vite.config.ts").is_file()


def test_the_fixture_holds_no_component_and_is_refused() -> None:
    kg = build_knowledge_graph(BROKEN)
    # Real sources, parsed successfully — the refusal is about content, not a
    # parse failure. That distinction is the whole point of the fixture.
    assert len(kg.files) > 0
    assert kg.components == []

    with pytest.raises(NothingToMigrate) as excinfo:
        analyze_graph(kg)

    message = str(excinfo.value)
    # The operator reading this must learn what to do, not merely that it failed.
    assert "No React components found" in message
    assert ".jsx/.tsx" in message
