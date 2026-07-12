"""Library rules.

A declarative ``KNOWN_LIBRARIES`` table (data, not code) maps dependencies to a
React Native migration verdict. Findings come from ``project.dependencies`` plus
two usage-derived signals the KG carries: Tailwind (via ``stylingApproach``) and
the bundler (``project.bundler``). Unknown dependencies are reported as
``unknown`` — never guessed.
"""

from __future__ import annotations

from typing import TypedDict

from app.models.analysis import (
    Evidence,
    Issue,
    LibraryCategory,
    LibraryFinding,
    LibraryStatus,
    RnEquivalent,
)
from app.models.knowledge_graph import KnowledgeGraph

from . import codes


class LibrarySpec(TypedDict):
    category: LibraryCategory
    status: LibraryStatus
    compatibility: int
    rnEquivalents: list[dict[str, str]]
    notes: str


def _rn(name: str, note: str = "") -> dict[str, str]:
    return {"name": name, "note": note}


# Shared spec for Redux and friends (external state managers, out of MVP scope).
_REDUX_UNSUPPORTED: LibrarySpec = {
    "category": "state", "status": "unsupported", "compatibility": 0,
    "rnEquivalents": [], "notes": "Out of MVP scope (external state manager).",
}

# The single source of truth for library verdicts. Data only.
KNOWN_LIBRARIES: dict[str, LibrarySpec] = {
    # --- Supported / compatible ---------------------------------------------
    "axios": {
        "category": "http", "status": "compatible", "compatibility": 100,
        "rnEquivalents": [], "notes": "Runs unchanged in React Native.",
    },
    "zustand": {
        "category": "state", "status": "compatible", "compatibility": 95,
        "rnEquivalents": [],
        "notes": "Works in RN; persistence middleware needs AsyncStorage.",
    },
    "react": {
        "category": "other", "status": "compatible", "compatibility": 100,
        "rnEquivalents": [], "notes": "Core; provided by React Native.",
    },
    # --- Needs conversion ----------------------------------------------------
    "react-dom": {
        "category": "other", "status": "needs-conversion", "compatibility": 90,
        "rnEquivalents": [_rn("react-native", "RN provides its own renderer")],
        "notes": "react-dom is dropped; the RN renderer replaces it.",
    },
    "react-router-dom": {
        "category": "routing", "status": "needs-conversion", "compatibility": 70,
        "rnEquivalents": [
            _rn("React Navigation", "stack/tab navigators"),
            _rn("Expo Router", "file-based routing"),
        ],
        "notes": "No DOM router in RN; migrate routes to navigators.",
    },
    "react-router": {
        "category": "routing", "status": "needs-conversion", "compatibility": 70,
        "rnEquivalents": [
            _rn("React Navigation", "stack/tab navigators"),
            _rn("Expo Router", "file-based routing"),
        ],
        "notes": "No DOM router in RN; migrate routes to navigators.",
    },
    "vite": {
        "category": "build", "status": "needs-conversion", "compatibility": 80,
        "rnEquivalents": [
            _rn("Metro", "RN's default bundler"),
            _rn("Expo", "toolchain + bundler"),
        ],
        "notes": "Web bundler; replaced by Metro/Expo.",
    },
    # --- Partial -------------------------------------------------------------
    "tailwindcss": {
        "category": "styling", "status": "partial", "compatibility": 65,
        "rnEquivalents": [_rn("NativeWind", "Tailwind for RN")],
        "notes": "Most utilities map via NativeWind; hover/grid/media do not.",
    },
    "framer-motion": {
        "category": "animation", "status": "partial", "compatibility": 50,
        "rnEquivalents": [
            _rn("Moti", "declarative animations"),
            _rn("react-native-reanimated", "underlying engine"),
        ],
        "notes": "framer-motion is web-only; re-author animations.",
    },
    # --- Explicitly NOT supported in MVP (see docs/PRD.md) -------------------
    "redux": _REDUX_UNSUPPORTED,
    "react-redux": _REDUX_UNSUPPORTED,
    "@reduxjs/toolkit": _REDUX_UNSUPPORTED,
    "three": {
        "category": "ui", "status": "unsupported", "compatibility": 0,
        "rnEquivalents": [], "notes": "Three.js / WebGL is out of MVP scope.",
    },
    "@react-three/fiber": {
        "category": "ui", "status": "unsupported", "compatibility": 0,
        "rnEquivalents": [], "notes": "Three.js renderer is out of MVP scope.",
    },
    "next": {
        "category": "build", "status": "unsupported", "compatibility": 0,
        "rnEquivalents": [], "notes": "Next.js / SSR is out of MVP scope.",
    },
    "electron": {
        "category": "build", "status": "unsupported", "compatibility": 0,
        "rnEquivalents": [], "notes": "Electron is out of MVP scope.",
    },
}


def _finding(name: str, version: str | None, spec: LibrarySpec) -> LibraryFinding:
    return LibraryFinding(
        name=name,
        version=version,
        category=spec["category"],
        status=spec["status"],
        compatibility=spec["compatibility"],
        rnEquivalents=[RnEquivalent(**e) for e in spec["rnEquivalents"]],
        notes=spec["notes"],
    )


def _unknown_finding(name: str, version: str | None) -> LibraryFinding:
    return LibraryFinding(
        name=name,
        version=version,
        category="other",
        status="unknown",
        compatibility=50,
        rnEquivalents=[],
        notes="Not in the known-library table; needs manual review.",
    )


def analyze_libraries(kg: KnowledgeGraph) -> list[LibraryFinding]:
    """Produce a LibraryFinding per dependency, plus usage-derived findings."""
    findings: list[LibraryFinding] = []
    seen: set[str] = set()

    def add(name: str, version: str | None) -> None:
        if name in seen:
            return
        seen.add(name)
        spec = KNOWN_LIBRARIES.get(name)
        findings.append(_finding(name, version, spec) if spec else _unknown_finding(name, version))

    # 1. Declared dependencies.
    for name, version in sorted(kg.project.dependencies.items()):
        add(name, version)

    # 2. Tailwind, detected from styling usage (often only a devDependency).
    uses_tailwind = any(
        "tailwind" in c.stylingApproach for c in kg.components
    )
    if uses_tailwind and "tailwindcss" not in seen:
        add("tailwindcss", None)

    # 3. Bundler, detected from project metadata.
    if kg.project.bundler and kg.project.bundler not in seen:
        add(kg.project.bundler, None)

    return findings


def library_issues(findings: list[LibraryFinding]) -> list[Issue]:
    """Top-level blockers/warnings derived from library findings."""
    issues: list[Issue] = []
    for f in findings:
        if f.status == "unsupported":
            issues.append(
                Issue(
                    code=codes.UNSUPPORTED_LIBRARY,
                    severity="blocker",
                    message=f"{f.name} is not supported in the MVP ({f.notes}).",
                    evidence=Evidence(file="package.json", detail=f"dependency: {f.name}"),
                )
            )
        elif f.status == "unknown":
            issues.append(
                Issue(
                    code=codes.UNKNOWN_LIBRARY,
                    severity="warning",
                    message=f"{f.name} is unknown to Rejox; migration impact needs review.",
                    evidence=Evidence(file="package.json", detail=f"dependency: {f.name}"),
                )
            )
    return issues
