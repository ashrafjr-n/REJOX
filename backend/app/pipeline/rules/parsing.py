"""Parsing rules.

The parser-worker degrades gracefully: a file it cannot load, type-check or
extract becomes a line in ``kg.warnings`` instead of killing the run. That makes
the graph **quietly incomplete** — a component in a file that failed to load is
simply absent, and every later rule (and the migration itself) then works from a
hole it cannot see.

This module turns those raw strings into report :class:`Issue`s so the hole is
visible wherever findings already are. Two severities, decided by what the
warning actually cost us:

- ``PARSE_FAILED`` (blocker) — the file is **not in the graph**: it failed to
  load or its extraction threw, or ``package.json`` did not parse (so the
  dependency list every library rule keys off is empty).
- ``PARSE_WARNING`` (warning) — the file **is** in the graph but was read
  imperfectly (syntax diagnostics; ts-morph still parses with recovery, so its
  extraction may be partial).

The object-config-router warning is deliberately skipped here: ``routing.py``
already reports it as ``OBJECT_ROUTER_UNPARSED`` with routing-specific wording,
and one fact should produce one issue.
"""

from __future__ import annotations

import re

from app.models.analysis import Evidence, Issue, Severity
from app.models.knowledge_graph import KnowledgeGraph

from . import codes

# Message shapes emitted by parser-worker/src/index.ts, in the order it emits
# them. Each entry: (pattern, severity, what the consequence actually is).
# Keep in sync with the `warnings.push(...)` calls in the worker.
_WARNING_SHAPES: list[tuple[re.Pattern[str], Severity, str]] = [
    (
        re.compile(r"^Failed to load (?P<file>.+?): "),
        "blocker",
        "the file could not be opened, so nothing in it is in the Knowledge Graph",
    ),
    (
        re.compile(r"^Failed to extract (?P<file>.+?): "),
        "blocker",
        "extraction threw, so this file's components/routes/stores are missing",
    ),
    (
        re.compile(r"^Failed to parse (?P<file>package\.json)"),
        "blocker",
        "dependencies could not be read, so every library finding is incomplete",
    ),
    (
        re.compile(r"^Syntax error in (?P<file>.+?): "),
        "warning",
        "the file has syntax errors; what was extracted from it may be partial",
    ),
    (
        re.compile(r"^Diagnostics failed for (?P<file>.+?): "),
        "warning",
        "the file could not be checked for syntax errors before extraction",
    ),
]

# Owned by routing.py (OBJECT_ROUTER_UNPARSED) — not repeated here.
_ROUTING_OWNED = ("Object-config router", "createBrowserRouter", "createHashRouter")


def _classify(warning: str) -> tuple[Severity, str, str | None]:
    """Return ``(severity, consequence, file)`` for one worker warning.

    An unrecognized shape is reported as a warning with no file rather than
    dropped: a new worker warning must never become invisible here.
    """
    for pattern, severity, consequence in _WARNING_SHAPES:
        match = pattern.match(warning)
        if match:
            return severity, consequence, match.group("file")
    return "warning", "the parser reported a problem while reading the project", None


def parse_issues(kg: KnowledgeGraph) -> list[Issue]:
    """Every ``kg.warnings`` line, as an Issue tied to the warning as evidence."""
    issues: list[Issue] = []
    for warning in kg.warnings:
        if any(token in warning for token in _ROUTING_OWNED):
            continue
        severity, consequence, file = _classify(warning)
        where = f"'{file}'" if file else "the project"
        issues.append(
            Issue(
                code=codes.PARSE_FAILED if severity == "blocker" else codes.PARSE_WARNING,
                severity=severity,
                message=f"Parsing {where} was incomplete — {consequence}.",
                evidence=Evidence(file=file, detail=warning),
            )
        )
    return issues
