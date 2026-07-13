"""Resolution cache.

The same residue recurs constantly across a project — ``hover:bg-indigo-500``
might appear in seven files. Resolving it once and reusing the answer is the
difference between ~100 LLM calls and ~8. This cache makes that reuse real, and
it is **instrumented** so we can report an honest hit-rate.

Key design
----------
The key is a stable hash of ``(issue_code, normalized_snippet, target_options)``.
Normalization strips the things that differ between two *semantically identical*
pieces of residue — file paths, line numbers, and (optionally) the enclosing
component names — so they collide onto one key.

Storage is SQLite (simple, local, no infra), hidden behind :class:`CacheBackend`
so swapping to Postgres/Redis later is a matter of one new backend class — the
:class:`ResolutionCache` API does not change.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from pydantic import BaseModel, ConfigDict

from app.ai.schemas import ResolutionResponse

# --- Normalization -----------------------------------------------------------

# RN / navigation primitives we must NOT treat as incidental component names —
# they are part of the residue's meaning, not noise.
_PRESERVED_IDENTIFIERS = frozenset({
    "View", "Text", "Image", "Pressable", "TouchableOpacity", "ScrollView",
    "FlatList", "SafeAreaView", "TextInput", "Button", "ActivityIndicator",
    "StyleSheet", "Animated", "Dimensions", "Platform", "Linking",
    "NavigationContainer", "Stack", "Tab", "Drawer", "Screen", "Navigator",
})

# Quoted or bare path-like tokens (contain a slash, or a code/style extension).
_PATH_RE = re.compile(
    r"""(['"])[^'"]*?/[^'"]*?\1"""            # quoted string containing a slash
    r"""|[\w./-]+\.(?:tsx?|jsx?|css|scss|sass|less)\b"""  # bare file path
)
# Line-number references that live in comments/messages ("at line 20", ":20:5").
_LINE_REF_RE = re.compile(r"\bline\s+\d+\b|:\d+:\d+\b|\bL\d+\b", re.IGNORECASE)
_WS_RUN_RE = re.compile(r"[ \t]+")


def normalize_snippet(
    snippet: str, *, component_names: Iterable[str] = ()
) -> str:
    """Erase file paths, line numbers, and (given) component names, then
    canonicalize whitespace — so identical residue from different files collides.
    """
    text = _PATH_RE.sub("<PATH>", snippet)
    text = _LINE_REF_RE.sub("<LINE>", text)

    for name in component_names:
        if name and name not in _PRESERVED_IDENTIFIERS:
            text = re.sub(rf"\b{re.escape(name)}\b", "<COMP>", text)

    lines = [_WS_RUN_RE.sub(" ", ln).strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def _canonical_options(target_options: dict[str, Any]) -> str:
    return json.dumps(target_options, sort_keys=True, separators=(",", ":"))


def cache_key(
    issue_code: str,
    snippet: str,
    target_options: dict[str, Any],
    *,
    component_names: Iterable[str] = (),
) -> str:
    """Stable content hash used as the cache key."""
    normalized = normalize_snippet(snippet, component_names=component_names)
    h = hashlib.sha256()
    h.update(issue_code.encode("utf-8"))
    h.update(b"\x00")
    h.update(normalized.encode("utf-8"))
    h.update(b"\x00")
    h.update(_canonical_options(target_options).encode("utf-8"))
    return h.hexdigest()


# --- Stored value ------------------------------------------------------------


class CachedResolution(BaseModel):
    """A cached resolution plus the metadata needed to audit/report it."""

    model_config = ConfigDict(extra="forbid")

    key: str
    response: ResolutionResponse
    model: str
    tokensIn: int = 0
    tokensOut: int = 0
    timestamp: str  # ISO-8601 UTC


# --- Backend (swappable) -----------------------------------------------------


class CacheBackend(ABC):
    """Storage seam. Swap SQLite → Postgres/Redis by implementing this."""

    @abstractmethod
    def get(self, key: str) -> Optional[str]:
        """Return the raw stored JSON for ``key``, or None."""

    @abstractmethod
    def set(self, key: str, value: str) -> None:
        """Store raw JSON ``value`` under ``key`` (upsert)."""

    @abstractmethod
    def count(self) -> int:
        """Number of stored entries."""


class SqliteBackend(CacheBackend):
    """SQLite-backed store. ``path=':memory:'`` keeps it fully in-process."""

    def __init__(self, path: str = ":memory:") -> None:
        self.path = path
        self._conn = sqlite3.connect(path)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS resolutions ("
            "  key TEXT PRIMARY KEY,"
            "  value TEXT NOT NULL,"
            "  created_at TEXT NOT NULL"
            ")"
        )
        self._conn.commit()

    def get(self, key: str) -> Optional[str]:
        row = self._conn.execute(
            "SELECT value FROM resolutions WHERE key = ?", (key,)
        ).fetchone()
        return row[0] if row else None

    def set(self, key: str, value: str) -> None:
        self._conn.execute(
            "INSERT INTO resolutions (key, value, created_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, "
            "created_at = excluded.created_at",
            (key, value, datetime.now(timezone.utc).isoformat()),
        )
        self._conn.commit()

    def count(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM resolutions").fetchone()[0]

    def close(self) -> None:
        self._conn.close()


# --- Instrumented cache ------------------------------------------------------


@dataclass
class CacheStats:
    hits: int = 0
    misses: int = 0
    entries: int = 0

    @property
    def lookups(self) -> int:
        return self.hits + self.misses

    @property
    def hitRate(self) -> float:
        return round(self.hits / self.lookups, 4) if self.lookups else 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "hits": self.hits,
            "misses": self.misses,
            "lookups": self.lookups,
            "hitRate": self.hitRate,
            "entries": self.entries,
        }


class ResolutionCache:
    """Content-addressed cache over a swappable backend, with hit/miss stats."""

    def __init__(self, backend: Optional[CacheBackend] = None) -> None:
        self.backend = backend or SqliteBackend(":memory:")
        self._hits = 0
        self._misses = 0

    def key_for(
        self,
        issue_code: str,
        snippet: str,
        target_options: dict[str, Any],
        *,
        component_names: Iterable[str] = (),
    ) -> str:
        return cache_key(
            issue_code, snippet, target_options, component_names=component_names
        )

    def get(
        self,
        issue_code: str,
        snippet: str,
        target_options: dict[str, Any],
        *,
        component_names: Iterable[str] = (),
    ) -> Optional[CachedResolution]:
        key = self.key_for(
            issue_code, snippet, target_options, component_names=component_names
        )
        raw = self.backend.get(key)
        if raw is None:
            self._misses += 1
            return None
        self._hits += 1
        return CachedResolution.model_validate_json(raw)

    def put(
        self,
        issue_code: str,
        snippet: str,
        target_options: dict[str, Any],
        response: ResolutionResponse,
        *,
        model: str,
        tokensIn: int = 0,
        tokensOut: int = 0,
        component_names: Iterable[str] = (),
    ) -> CachedResolution:
        key = self.key_for(
            issue_code, snippet, target_options, component_names=component_names
        )
        cached = CachedResolution(
            key=key,
            response=response,
            model=model,
            tokensIn=tokensIn,
            tokensOut=tokensOut,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        self.backend.set(key, cached.model_dump_json())
        return cached

    def stats(self) -> CacheStats:
        return CacheStats(hits=self._hits, misses=self._misses, entries=self.backend.count())
