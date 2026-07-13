"""Styling Resolver — the three-tier ladder, proven offline.

Every test injects :class:`FakeProvider`; the network is never touched and the
LLM-parse gate is stubbed so no Node subprocess runs. The load-bearing
assertions are about *which tier* resolves each class — the whole design goal is
that the LLM is reached as rarely as possible, so most of these assert the
provider was **never called**.
"""

from __future__ import annotations

from collections import Counter

from app.ai.cache import ResolutionCache
from app.ai.provider import FakeProvider
from app.ai.schemas import ResolutionResponse
from app.ai.styling import (
    MappedResidue,
    Resolution,
    ResolutionTier,
    resolve_styling,
)
from app.ai.styling.models import confidence_source_for
from app.models.analysis import ConfidenceSource

NW = {"stylingEngine": "nativewind"}

# The real TW_UNSUPPORTED residue the Deterministic Transformer leaves on
# sample-app (captured by running transform_component over every component —
# ground truth, not a guess). Baked in so this test stays fast and Node-free.
SAMPLE_APP_RESIDUE: dict[str, str] = {
    "Button.tsx": "hover:bg-indigo-50 hover:bg-indigo-500 transition-colors",
    "CartBadge.tsx": "hover:bg-slate-100",
    "CartItem.tsx": "hover:text-red-500",
    "CartSummary.tsx": "divide-slate-100 divide-y",
    "FeatureCard.tsx": "hover:shadow-md transition-shadow",
    "Hero.tsx": "bg-gradient-to-br from-indigo-600 hover:bg-indigo-50 to-violet-600",
    "Navbar.tsx": "backdrop-blur hover:bg-slate-100 sticky transition-colors",
    "ProductCard.tsx": "hover:text-indigo-600",
    "ProductGrid.tsx": "grid grid-cols-1 lg:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4",
    "QuantityStepper.tsx": "hover:bg-slate-200",
    "SettingToggle.tsx": "transition-colors transition-transform",
    "Spinner.tsx": "animate-spin",
    "HomePage.tsx": "grid grid-cols-1 md:grid-cols-3",
    "ProductDetailPage.tsx": "grid grid-cols-1 hover:underline md:grid-cols-2",
    "SettingsPage.tsx": "divide-slate-100 divide-y",
}


def _resolve_one(snippet: str, provider: FakeProvider, **kw) -> list[Resolution]:
    return resolve_styling(
        [MappedResidue(snippet=snippet, componentName="C", sourceFile="C.tsx")],
        NW,
        provider=provider,
        syntax_check=lambda code: 0,  # pretend everything parses
        **kw,
    )


def _only(res: list[Resolution], substr: str) -> Resolution:
    """The single resolution whose input snippet contains ``substr``."""
    hits = [r for r in res if substr in r.snippet]
    assert len(hits) == 1, f"expected exactly one unit containing {substr!r}, got {res}"
    return hits[0]


# --- Tier 1: static map ------------------------------------------------------


def test_divide_and_animate_spin_resolve_via_static_map_with_zero_llm() -> None:
    provider = FakeProvider()

    divide = _resolve_one("divide-slate-100 divide-y", provider)
    assert len(divide) == 1
    assert divide[0].tier is ResolutionTier.STATIC_MAP
    assert "borderTopWidth" in divide[0].response.code

    spin = _resolve_one("animate-spin", provider)
    assert spin[0].tier is ResolutionTier.STATIC_MAP
    assert "withRepeat" in spin[0].response.code  # documented Reanimated snippet

    assert provider.calls == 0, "static-map classes must never reach the LLM"


def test_backdrop_and_sticky_resolve_via_static_map() -> None:
    provider = FakeProvider()
    res = _resolve_one("backdrop-blur sticky", provider)
    tiers = {r.snippet: r.tier for r in res}
    assert tiers["backdrop-blur"] is ResolutionTier.STATIC_MAP
    assert tiers["sticky"] is ResolutionTier.STATIC_MAP
    assert "BlurView" in _only(res, "backdrop").response.code
    assert provider.calls == 0


def test_transition_is_dropped_as_a_lossless_static_rule() -> None:
    provider = FakeProvider()
    res = _resolve_one("transition-colors", provider)
    assert res[0].tier is ResolutionTier.STATIC_MAP
    assert res[0].response.code == ""  # dropped — no CSS transitions in RN
    assert res[0].response.unresolvable is False
    assert provider.calls == 0


# --- Tier 2: patterns --------------------------------------------------------


def test_hover_resolves_via_pattern_to_active_variant_no_llm() -> None:
    provider = FakeProvider()
    res = _resolve_one("hover:bg-indigo-500", provider)
    assert res[0].tier is ResolutionTier.PATTERN
    assert res[0].response.code == "active:bg-indigo-500"
    assert provider.calls == 0


def test_grid_resolves_via_pattern_into_a_flexwrap_layout_no_llm() -> None:
    provider = FakeProvider()
    res = _resolve_one("grid grid-cols-3 gap-4", provider)
    grid = _only(res, "grid-cols-3")
    assert grid.tier is ResolutionTier.PATTERN
    assert "flex-wrap" in grid.response.code
    assert "33.3333%" in grid.note  # 100/3 child width — the standard reflow
    assert provider.calls == 0


def test_hero_gradient_resolves_via_pattern_to_linear_gradient() -> None:
    provider = FakeProvider()
    res = _resolve_one(SAMPLE_APP_RESIDUE["Hero.tsx"], provider)
    gradient = _only(res, "bg-gradient")
    assert gradient.tier is ResolutionTier.PATTERN
    assert "<LinearGradient" in gradient.response.code
    # from-indigo-600 / to-violet-600 mapped to concrete hex, direction to-br.
    assert "#4f46e5" in gradient.response.code
    assert "#7c3aed" in gradient.response.code
    assert "x: 1, y: 1" in gradient.response.code
    assert provider.calls == 0


# --- Tier 3: LLM (only for genuinely novel classes) --------------------------


def test_only_novel_classes_reach_the_llm() -> None:
    provider = FakeProvider()
    # `mix-blend-multiply` has no static rule and no pattern — it is the residue
    # of the residue, and only this kind of class may reach the LLM.
    res = _resolve_one("mix-blend-multiply", provider)
    assert res[0].tier is ResolutionTier.LLM
    assert provider.calls == 1, "a novel class SHOULD reach the LLM exactly once"


def test_unparseable_llm_output_retries_once_then_unresolvable() -> None:
    provider = FakeProvider()
    # syntax_check reports an error for everything → parse gate always fails.
    res = resolve_styling(
        [MappedResidue(snippet="mix-blend-multiply", componentName="C")],
        NW,
        provider=provider,
        syntax_check=lambda code: 1,
    )
    assert res[0].tier is ResolutionTier.LLM
    assert res[0].response.unresolvable is True
    assert res[0].response.reason
    assert provider.calls == 2, "exactly one retry: initial + one more, then give up"


def test_llm_unresolvable_sentinel_needs_no_parse_gate() -> None:
    provider = FakeProvider()
    # Register the model's answer for this exact prompt: the UNRESOLVABLE sentinel.
    from app.ai.styling.resolver import _build_system, _build_user

    system = _build_system("nativewind")
    user = _build_user("mix-blend-multiply", "", NW)
    provider.register(system, user, "UNRESOLVABLE: no blend modes in RN")

    res = _resolve_one("mix-blend-multiply", provider)
    assert res[0].response.unresolvable is True
    assert "blend" in res[0].response.reason
    assert provider.calls == 1  # sentinel short-circuits — no retry


# --- Cache: identical residue costs at most one LLM call ---------------------


def test_same_novel_class_in_two_files_is_one_llm_call() -> None:
    provider = FakeProvider()
    cache = ResolutionCache()
    residue = [
        MappedResidue(snippet="mix-blend-multiply", componentName="Navbar", sourceFile="Navbar.tsx"),
        MappedResidue(snippet="mix-blend-multiply", componentName="Footer", sourceFile="Footer.tsx"),
    ]
    out = resolve_styling(residue, NW, provider=provider, cache=cache, syntax_check=lambda c: 0)
    assert len(out) == 2
    assert all(r.tier is ResolutionTier.LLM for r in out)
    assert provider.calls == 1, "the second file must hit the cache, not the LLM"
    assert cache.stats().hits == 1


def test_recurring_hover_across_files_never_calls_the_llm() -> None:
    provider = FakeProvider()
    residue = [
        MappedResidue(snippet="hover:bg-slate-100", componentName="Navbar"),
        MappedResidue(snippet="hover:bg-slate-100", componentName="CartBadge"),
    ]
    out = resolve_styling(residue, NW, provider=provider, syntax_check=lambda c: 0)
    assert all(r.tier is ResolutionTier.PATTERN for r in out)
    assert provider.calls == 0  # patterns are deterministic — cost is zero, not "cached"


# --- The whole point: sample-app resolves with (near) zero LLM ---------------


def test_sample_app_residue_tier_distribution_and_llm_count() -> None:
    provider = FakeProvider()
    residue = [
        MappedResidue(snippet=snip, sourceFile=f, componentName=f.replace(".tsx", ""))
        for f, snip in SAMPLE_APP_RESIDUE.items()
    ]
    out = resolve_styling(residue, NW, provider=provider, syntax_check=lambda c: 0)

    tiers = Counter(r.tier.value for r in out)
    print(
        f"\nsample-app styling residue: {len(SAMPLE_APP_RESIDUE)} files → "
        f"{len(out)} units | tiers={dict(tiers)} | "
        f"LLM calls={provider.calls} | cache hit-rate=n/a (no LLM tier reached)"
    )

    # The design goal, asserted: every real styling class resolves by rule.
    assert tiers.get("llm", 0) == 0
    assert provider.calls == 0
    assert tiers["pattern"] + tiers["static_map"] == len(out)


def test_confidence_source_maps_from_tier() -> None:
    provider = FakeProvider()
    pattern = _resolve_one("hover:bg-indigo-500", provider)[0]
    static = _resolve_one("animate-spin", provider)[0]
    assert confidence_source_for(pattern) is ConfidenceSource.DETERMINISTIC_WARNING
    assert confidence_source_for(static) is ConfidenceSource.DETERMINISTIC_WARNING

    llm = _resolve_one("mix-blend-multiply", provider)[0]
    assert confidence_source_for(llm) is ConfidenceSource.AI_VALIDATED

    unresolved = Resolution(
        snippet="x",
        tier=ResolutionTier.LLM,
        response=ResolutionResponse(unresolvable=True, reason="r"),
    )
    assert confidence_source_for(unresolved) is ConfidenceSource.UNHANDLED
