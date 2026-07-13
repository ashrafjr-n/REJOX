"""Tests for the AI Resolution Engine foundation (plumbing only).

These prove the seams work WITHOUT resolving any real residue and WITHOUT ever
touching the network: every test injects :class:`FakeProvider`. The Gemini SDK
is not imported at all.
"""

from __future__ import annotations

import sys

import pytest

from app.ai.cache import (
    ResolutionCache,
    SqliteBackend,
    cache_key,
    normalize_snippet,
)
from app.ai.config import AIConfig, get_provider, load_config
from app.ai.provider import (
    FakeProvider,
    GeminiProvider,
    LLMResponse,
    ProviderError,
    prompt_hash,
)
from app.ai.schemas import (
    DEFAULT_MAX_SNIPPET_LINES,
    ResolutionRequest,
    ResolutionResponse,
    SnippetBudgetError,
)
from app.models.validation import Diagnostic


# --- No network --------------------------------------------------------------


def test_importing_ai_layer_never_imports_the_sdk() -> None:
    # The vendor SDK must be lazy: importing our AI modules must not pull it in.
    assert "google.genai" not in sys.modules
    assert "google.generativeai" not in sys.modules


def test_fake_is_selected_and_offline_for_tests() -> None:
    provider = get_provider(AIConfig(provider="fake"))
    assert isinstance(provider, FakeProvider)


def test_gemini_without_key_fails_clearly_and_never_calls_out() -> None:
    with pytest.raises(ProviderError):
        get_provider(AIConfig(provider="gemini", geminiApiKey=None))
    # Constructed with a (dummy) key, it still must not touch the network until
    # complete() is called — construction alone is inert.
    provider = GeminiProvider(api_key="dummy", model="gemini-2.5-flash")
    assert provider.model == "gemini-2.5-flash"
    assert "google.genai" not in sys.modules


# --- FakeProvider round-trip -------------------------------------------------


def test_fakeprovider_round_trips_a_request_response() -> None:
    provider = FakeProvider()
    request = ResolutionRequest(
        issueCode="TW_UNSUPPORTED",
        snippet='className="hover:bg-indigo-500"',
        context="<Button>Shop</Button>",
        targetOptions={"stylingEngine": "nativewind"},
        diagnostics=[],
    )
    # A canned resolution the "model" returns for this exact prompt.
    system = "You resolve one piece of React Native migration residue."
    user = f"{request.issueCode}\n{request.snippet}\n{request.context}"
    canned = ResolutionResponse(
        code="active:bg-indigo-500",
        explanation="Touch has no hover; map to a pressed state.",
        confidence="medium",
    )
    provider.register(system, user, canned.model_dump_json())

    resp: LLMResponse = provider.complete(system, user, max_tokens=256)
    assert resp.model == "fake-1"
    assert resp.latencyMs == 0
    parsed = ResolutionResponse.model_validate_json(resp.text)
    assert parsed.code == "active:bg-indigo-500"
    assert parsed.confidence == "medium"


def test_fakeprovider_is_deterministic() -> None:
    p = FakeProvider()
    a = p.complete("sys", "same prompt", max_tokens=10)
    b = p.complete("sys", "same prompt", max_tokens=10)
    assert a.text == b.text
    assert prompt_hash("sys", "same prompt") == prompt_hash("sys", "same prompt")
    assert prompt_hash("sys", "a") != prompt_hash("sys", "b")


# --- Cache: semantically identical residue collides --------------------------


def test_identical_residue_from_different_files_yields_a_hit() -> None:
    cache = ResolutionCache()
    opts = {"stylingEngine": "nativewind"}
    # Same residue, different file / line / component in the surrounding text.
    snippet_navbar = 'className="hover:bg-indigo-500"  // Navbar.tsx at line 20'
    snippet_footer = 'className="hover:bg-indigo-500"  // Footer.tsx at line 8'

    key_a = cache.key_for("TW_UNSUPPORTED", snippet_navbar, opts, component_names=["Navbar"])
    key_b = cache.key_for("TW_UNSUPPORTED", snippet_footer, opts, component_names=["Footer"])
    assert key_a == key_b, "path/line/component differences must not change the key"

    # First lookup misses, we store, second (from a different file) hits.
    assert cache.get("TW_UNSUPPORTED", snippet_navbar, opts, component_names=["Navbar"]) is None
    cache.put(
        "TW_UNSUPPORTED",
        snippet_navbar,
        opts,
        ResolutionResponse(code="active:bg-indigo-500", confidence="medium"),
        model="fake-1",
        tokensIn=12,
        tokensOut=4,
        component_names=["Navbar"],
    )
    hit = cache.get("TW_UNSUPPORTED", snippet_footer, opts, component_names=["Footer"])
    assert hit is not None
    assert hit.response.code == "active:bg-indigo-500"
    assert hit.model == "fake-1"

    stats = cache.stats()
    assert stats.hits == 1 and stats.misses == 1
    assert stats.entries == 1
    assert stats.hitRate == 0.5


def test_normalization_strips_paths_and_line_numbers() -> None:
    a = normalize_snippet("import s from './ProductCard.module.css' // at line 7")
    b = normalize_snippet("import s from './ProductCard.module.css' // at line 99")
    assert a == b
    assert "<PATH>" in a and "<LINE>" in a


def test_different_issue_code_or_options_do_not_collide() -> None:
    snip = 'className="hover:bg-indigo-500"'
    base = cache_key("TW_UNSUPPORTED", snip, {"stylingEngine": "nativewind"})
    assert cache_key("CSS_MODULE", snip, {"stylingEngine": "nativewind"}) != base
    assert cache_key("TW_UNSUPPORTED", snip, {"stylingEngine": "stylesheet"}) != base


def test_cache_backend_is_swappable_via_interface() -> None:
    # The cache depends only on the CacheBackend interface — a fresh SqliteBackend
    # (e.g. a file path, or a future Postgres/Redis backend) drops in unchanged.
    cache = ResolutionCache(backend=SqliteBackend(":memory:"))
    opts: dict = {}
    cache.put(
        "NAV_ACTIVE", "isActive styling", opts,
        ResolutionResponse(code="", unresolvable=True, reason="navigation state is design"),
        model="fake-1",
    )
    hit = cache.get("NAV_ACTIVE", "isActive styling", opts)
    assert hit is not None and hit.response.unresolvable is True


# --- Budget guard: snippet may never be a whole file -------------------------


def test_budget_guard_raises_on_oversized_request() -> None:
    big = "\n".join(f"const line{i} = {i};" for i in range(DEFAULT_MAX_SNIPPET_LINES + 5))
    with pytest.raises(SnippetBudgetError):
        ResolutionRequest(issueCode="CSS_MODULE", snippet=big, context="")


def test_budget_counts_snippet_plus_context() -> None:
    snippet = "\n".join(["a = 1"] * 40)
    context = "\n".join(["b = 2"] * 40)  # 80 combined > 60
    with pytest.raises(SnippetBudgetError):
        ResolutionRequest(issueCode="X", snippet=snippet, context=context)


def test_budget_is_configurable_per_request() -> None:
    lines = "\n".join(["x = 1"] * 100)
    # A generous explicit budget lets a larger slice through.
    req = ResolutionRequest(issueCode="X", snippet=lines, context="", maxSnippetLines=200)
    assert req.maxSnippetLines == 200
    # ...but the default still refuses it.
    with pytest.raises(SnippetBudgetError):
        ResolutionRequest(issueCode="X", snippet=lines, context="")


def test_request_carries_diagnostics_contract() -> None:
    diag = Diagnostic(source="typecheck", file="src/components/Layout.tsx", line=14,
                      code="TS2304", severity="error", message="Cannot find name 'Outlet'.")
    req = ResolutionRequest(
        issueCode="NAV_CONTAINER", snippet="<Outlet />", context="<View>...</View>",
        diagnostics=[diag],
    )
    assert req.diagnostics[0].code == "TS2304"


# --- Config ------------------------------------------------------------------


def test_config_is_env_driven() -> None:
    cfg = load_config(env={"REJOX_AI_PROVIDER": "fake", "GEMINI_MODEL": "gemini-x"})
    assert cfg.provider == "fake"
    assert cfg.geminiModel == "gemini-x"
    # Default provider is gemini (real intent); tests override to fake.
    assert load_config(env={}).provider == "gemini"
