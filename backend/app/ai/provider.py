"""LLM provider abstraction.

A thin seam over whichever LLM vendor the AI Resolution Engine calls. The rest
of the codebase depends ONLY on :class:`LLMProvider` / :class:`LLMResponse`, so
swapping vendors is a one-line change in :mod:`app.ai.config`.

Two implementations ship today:

- :class:`GeminiProvider` — the real vendor (Google Gemini, official SDK). The
  SDK is imported lazily so tests never need it installed and never hit the
  network.
- :class:`FakeProvider` — deterministic, offline. Canned responses keyed by a
  hash of the prompt. This is what tests inject everywhere.

No resolver logic lives here — this is plumbing only.
"""

from __future__ import annotations

import hashlib
import time
from abc import ABC, abstractmethod
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class LLMResponse(BaseModel):
    """The normalized result of one completion, vendor-independent."""

    model_config = ConfigDict(extra="forbid")

    text: str
    tokensIn: int = 0
    tokensOut: int = 0
    model: str
    latencyMs: int = 0


class LLMProvider(ABC):
    """The only LLM surface the rest of Rejox is allowed to depend on."""

    @abstractmethod
    def complete(self, system: str, user: str, *, max_tokens: int) -> LLMResponse:
        """Run one completion and return a normalized :class:`LLMResponse`."""
        raise NotImplementedError


class ProviderError(RuntimeError):
    """Raised when a provider cannot be constructed or called (missing key…)."""


# --- Gemini (real) -----------------------------------------------------------


DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


class GeminiProvider(LLMProvider):
    """Google Gemini via the official ``google-genai`` SDK.

    The SDK and network are touched only inside :meth:`complete` (lazy import),
    so importing this module never requires the SDK and tests stay offline.
    """

    def __init__(self, api_key: Optional[str], model: str = DEFAULT_GEMINI_MODEL) -> None:
        if not api_key:
            raise ProviderError(
                "GEMINI_API_KEY is not set. Export it (see .env.example) or select "
                "the 'fake' provider for offline runs."
            )
        self._api_key = api_key
        self.model = model
        self._client = None  # constructed lazily on first call

    def _get_client(self):
        if self._client is None:
            try:
                from google import genai  # type: ignore
            except ImportError as exc:  # pragma: no cover - depends on env
                raise ProviderError(
                    "The 'google-genai' SDK is not installed. `pip install "
                    "google-genai` to use GeminiProvider, or use the 'fake' provider."
                ) from exc
            self._client = genai.Client(api_key=self._api_key)
        return self._client

    def complete(self, system: str, user: str, *, max_tokens: int) -> LLMResponse:
        from google.genai import types  # type: ignore  # pragma: no cover

        client = self._get_client()
        started = time.monotonic()
        resp = client.models.generate_content(
            model=self.model,
            contents=user,
            config=types.GenerateContentConfig(
                system_instruction=system,
                max_output_tokens=max_tokens,
            ),
        )
        latency_ms = int((time.monotonic() - started) * 1000)
        usage = getattr(resp, "usage_metadata", None)
        return LLMResponse(
            text=resp.text or "",
            tokensIn=getattr(usage, "prompt_token_count", 0) or 0,
            tokensOut=getattr(usage, "candidates_token_count", 0) or 0,
            model=self.model,
            latencyMs=latency_ms,
        )


# --- Fake (deterministic, offline) -------------------------------------------


def prompt_hash(system: str, user: str) -> str:
    """Stable hash of a prompt — the FakeProvider's canned-response key."""
    h = hashlib.sha256()
    h.update(system.encode("utf-8"))
    h.update(b"\x00")
    h.update(user.encode("utf-8"))
    return h.hexdigest()


class FakeProvider(LLMProvider):
    """Deterministic, offline provider. NEVER touches the network.

    Returns canned responses keyed by :func:`prompt_hash`. Unknown prompts get a
    stable, reproducible synthetic response derived from the prompt hash, so
    tests are fully deterministic without registering every prompt.
    """

    model_name = "fake-1"

    def __init__(self, responses: Optional[dict[str, str]] = None) -> None:
        # Map prompt_hash -> canned text.
        self._responses: dict[str, str] = dict(responses or {})
        self.calls = 0

    def register(self, system: str, user: str, text: str) -> None:
        self._responses[prompt_hash(system, user)] = text

    def complete(self, system: str, user: str, *, max_tokens: int) -> LLMResponse:
        self.calls += 1
        key = prompt_hash(system, user)
        text = self._responses.get(key)
        if text is None:
            # Deterministic synthetic answer — reproducible across runs.
            text = f"FAKE_RESPONSE[{key[:12]}]"
        return LLMResponse(
            text=text,
            tokensIn=len(system.split()) + len(user.split()),
            tokensOut=len(text.split()),
            model=self.model_name,
            latencyMs=0,
        )
