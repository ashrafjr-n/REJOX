"""AI Resolution Engine — configuration (env-driven).

Selecting a provider or model must be a one-line, config-only change — no
edits scattered through the resolver. Everything the AI layer needs is read
from the environment here.

Environment variables
---------------------
- ``REJOX_AI_PROVIDER`` — ``"gemini"`` (default) or ``"fake"``.
- ``GEMINI_API_KEY``    — required by the Gemini provider.
- ``GEMINI_MODEL``      — Gemini model id (default: a Flash-tier model).
- ``REJOX_AI_CACHE``    — SQLite path for the resolution cache.
- ``REJOX_AI_MAX_SNIPPET_LINES`` — snippet+context line budget (default 60).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.ai.provider import (
    DEFAULT_GEMINI_MODEL,
    FakeProvider,
    GeminiProvider,
    LLMProvider,
)
from app.ai.schemas import DEFAULT_MAX_SNIPPET_LINES

_DEFAULT_CACHE_PATH = Path(__file__).resolve().parents[2] / ".rejox-ai-cache.sqlite3"


@dataclass(frozen=True)
class AIConfig:
    provider: str = "gemini"
    geminiApiKey: Optional[str] = None
    geminiModel: str = DEFAULT_GEMINI_MODEL
    cachePath: str = str(_DEFAULT_CACHE_PATH)
    maxSnippetLines: int = DEFAULT_MAX_SNIPPET_LINES


def load_config(env: Optional[dict[str, str]] = None) -> AIConfig:
    """Read the AI config from ``env`` (defaults to ``os.environ``)."""
    e = env if env is not None else os.environ
    return AIConfig(
        provider=e.get("REJOX_AI_PROVIDER", "gemini").strip().lower(),
        geminiApiKey=e.get("GEMINI_API_KEY"),
        geminiModel=e.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
        cachePath=e.get("REJOX_AI_CACHE", str(_DEFAULT_CACHE_PATH)),
        maxSnippetLines=int(e.get("REJOX_AI_MAX_SNIPPET_LINES", DEFAULT_MAX_SNIPPET_LINES)),
    )


def get_provider(config: Optional[AIConfig] = None) -> LLMProvider:
    """Construct the configured provider. Swapping vendors happens ONLY here."""
    cfg = config or load_config()
    if cfg.provider == "fake":
        return FakeProvider()
    if cfg.provider == "gemini":
        return GeminiProvider(api_key=cfg.geminiApiKey, model=cfg.geminiModel)
    raise ValueError(
        f"Unknown REJOX_AI_PROVIDER {cfg.provider!r}; expected 'gemini' or 'fake'."
    )
