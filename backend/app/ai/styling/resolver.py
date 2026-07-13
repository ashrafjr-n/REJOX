"""Tier 3 — the LLM fallback, and the three-tier orchestrator.

``resolve_styling`` is the public entry point. For each file's residue it
partitions the class bag into resolvable units and runs each **down the ladder**:

    static_map  →  pattern  →  llm

Only what tiers 1 and 2 genuinely cannot answer reaches the LLM here, and even
then every call is content-addressed through the cache, its output is stripped
of markdown, **re-parsed by the codemod-worker** (never emit code that doesn't
parse — retry once with the error, then give up), and its tokens are logged.

The LLM is the residue of the residue. The lower its call count, the better the
design — that is the whole point of the tiers above it.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Optional

from app.ai.cache import ResolutionCache
from app.ai.config import AIConfig, get_provider
from app.ai.provider import LLMProvider
from app.ai.schemas import ResolutionResponse
from app.ai.styling import known_map, patterns
from app.ai.styling.models import (
    LadderResult,
    MappedResidue,
    Resolution,
    ResolutionTier,
)

STYLING_MAX_TOKENS = 512
ISSUE_CODE = "TW_UNSUPPORTED"

# The model must return ONLY a replacement expression — or this sentinel.
_UNRESOLVABLE = "UNRESOLVABLE"
_FENCE_RE = re.compile(r"^```[a-zA-Z0-9]*\n?|\n?```$", re.MULTILINE)

_VARIANTS = ("sm:", "md:", "lg:", "xl:", "2xl:", "dark:", "hover:", "focus:", "active:")


def _strip_variants(token: str) -> str:
    changed = True
    while changed:
        changed = False
        for v in _VARIANTS:
            if token.startswith(v):
                token = token[len(v):]
                changed = True
    return token


def partition(classes: list[str]) -> list[list[str]]:
    """Split a file's residue bag into resolvable units.

    Structural cases are grouped so a tier sees them whole: every gradient token
    is one unit, every grid token is one unit, every ``divide-*`` is one unit.
    Everything else (``hover:``, ``sticky``, ``animate-*`` …) is its own unit —
    the residue bag spans a whole file, so unrelated singles must not be merged.
    """
    gradient: list[str] = []
    grid: list[str] = []
    divide: list[str] = []
    gaps: list[str] = []
    singles: list[str] = []
    for c in classes:
        if patterns.is_gradient(c):
            gradient.append(c)
        elif patterns.is_grid(c):
            grid.append(c)
        elif _strip_variants(c).startswith("divide-"):
            divide.append(c)
        elif _strip_variants(c).startswith("gap-") or _strip_variants(c) == "gap":
            gaps.append(c)
        else:
            singles.append(c)

    # `gap-*` is a flex-gap the grid reflow keeps; it only rides with a grid unit.
    # (Standalone gap is a supported NativeWind class and never appears in residue.)
    if grid:
        grid = grid + gaps
    else:
        singles = singles + gaps

    units: list[list[str]] = []
    if gradient:
        units.append(sorted(gradient))
    if grid:
        units.append(sorted(grid))
    if divide:
        units.append(sorted(divide))
    units.extend([c] for c in sorted(singles))
    return units


def _strip_fences(text: str) -> str:
    return _FENCE_RE.sub("", text).strip()


def _build_system(styling_engine: str) -> str:
    target = (
        "NativeWind `className` strings"
        if styling_engine == "nativewind"
        else "React Native `StyleSheet` objects / JSX"
    )
    return (
        "You are a React Native styling expert resolving ONE unsupported Tailwind "
        "utility that has no NativeWind mapping. "
        f"The target styling engine is {styling_engine}; express the answer as {target}. "
        "Rules: output ONLY the replacement expression — a className string, a "
        "style object, or a single JSX element. No prose, no explanation, no "
        "markdown fences, and no import statements. If the utility genuinely "
        "cannot be expressed in React Native, output exactly "
        f"`{_UNRESOLVABLE}: <short reason>` and nothing else."
    )


def _build_user(snippet: str, context: str, options: dict[str, Any]) -> str:
    parts = [f"Unsupported class(es): {snippet}"]
    if context.strip():
        parts.append(f"Minimal context:\n{context.strip()}")
    parts.append(f"Target options: {options}")
    return "\n".join(parts)


class StylingResolver:
    """Runs the three-tier ladder over styling residue.

    Deterministic tiers need nothing but the class tokens. The LLM tier needs a
    provider, the cache, and a syntax check — all injectable so tests stay
    offline and Node-free. In production the syntax check defaults to the
    codemod-worker's re-parse (``transformer.check_syntax``), reused verbatim.
    """

    def __init__(
        self,
        options: Optional[dict[str, Any]] = None,
        *,
        provider: Optional[LLMProvider] = None,
        cache: Optional[ResolutionCache] = None,
        syntax_check: Optional[Callable[[str], int]] = None,
        config: Optional[AIConfig] = None,
    ) -> None:
        self.options: dict[str, Any] = dict(options or {})
        self._provider = provider
        self._config = config
        self.cache = cache or ResolutionCache()
        self._syntax_check = syntax_check
        self.styling_engine = str(self.options.get("stylingEngine", "nativewind"))

    # -- lazy deps (only paid for if the LLM tier is actually reached) --------

    @property
    def provider(self) -> LLMProvider:
        if self._provider is None:
            self._provider = get_provider(self._config)
        return self._provider

    def _parse_errors(self, code: str) -> int:
        check = self._syntax_check
        if check is None:
            from app.pipeline.transformer import check_syntax  # lazy: needs Node

            check = check_syntax
        # Wrap as a parenthesized expression so a className string, a style
        # object, or a JSX element each parse in isolation.
        return check(f"const __rejox_resolution =\n(\n{code}\n);")

    # -- the ladder -----------------------------------------------------------

    def resolve(self, residue: MappedResidue) -> list[Resolution]:
        out: list[Resolution] = []
        for unit in partition(residue.classes):
            ladder = (
                known_map.resolve(unit, self.options)
                or patterns.resolve(unit, self.options)
                or self._resolve_llm(unit, residue)
            )
            out.append(
                Resolution(
                    issueCode=residue.issueCode,
                    snippet=" ".join(unit),
                    tier=ladder.tier,
                    response=ladder.response,
                    note=ladder.note,
                    componentName=residue.componentName,
                    sourceFile=residue.sourceFile,
                )
            )
        return out

    # -- tier 3 ---------------------------------------------------------------

    def _resolve_llm(self, unit: list[str], residue: MappedResidue) -> LadderResult:
        snippet = " ".join(unit)
        comps = [residue.componentName] if residue.componentName else []

        cached = self.cache.get(ISSUE_CODE, snippet, self.options, component_names=comps)
        if cached is not None:
            return LadderResult(tier=ResolutionTier.LLM, response=cached.response)

        response = self._call_llm(snippet, residue.context)
        # Cache the outcome (resolved OR unresolvable) so identical residue in
        # another file never pays for a second call.
        self.cache.put(
            ISSUE_CODE,
            snippet,
            self.options,
            response,
            model=getattr(self.provider, "model", getattr(self.provider, "model_name", "?")),
            component_names=comps,
        )
        return LadderResult(tier=ResolutionTier.LLM, response=response)

    def _call_llm(self, snippet: str, context: str) -> ResolutionResponse:
        system = _build_system(self.styling_engine)
        user = _build_user(snippet, context, self.options)

        raw = self.provider.complete(system, user, max_tokens=STYLING_MAX_TOKENS)
        code, verdict = self._interpret(raw.text)
        if verdict is not None:
            return verdict  # unresolvable sentinel — no parse gate needed
        if self._parse_errors(code) == 0:
            return ResolutionResponse(
                code=code,
                explanation="Resolved by the LLM tier; output re-parsed clean.",
                confidence="medium",
            )

        # Retry ONCE with the parse failure appended — never emit unparseable code.
        retry_user = (
            f"{user}\n\nYour previous answer did not parse as valid TS/JSX:\n{code}\n"
            "Return a corrected replacement expression, or the UNRESOLVABLE sentinel."
        )
        raw2 = self.provider.complete(system, retry_user, max_tokens=STYLING_MAX_TOKENS)
        code2, verdict2 = self._interpret(raw2.text)
        if verdict2 is not None:
            return verdict2
        if self._parse_errors(code2) == 0:
            return ResolutionResponse(
                code=code2,
                explanation="Resolved by the LLM tier on retry; output re-parsed clean.",
                confidence="low",
            )
        return ResolutionResponse(
            unresolvable=True,
            reason="LLM output did not parse as valid TS/JSX after one retry.",
        )

    @staticmethod
    def _interpret(text: str) -> tuple[str, Optional[ResolutionResponse]]:
        """Return (code, unresolvable-response-or-None) from a raw completion."""
        code = _strip_fences(text)
        if code.startswith(_UNRESOLVABLE):
            reason = code[len(_UNRESOLVABLE):].lstrip(": ").strip() or "LLM declared it unresolvable."
            return "", ResolutionResponse(unresolvable=True, reason=reason)
        if not code:
            return "", ResolutionResponse(
                unresolvable=True, reason="LLM returned an empty replacement."
            )
        return code, None


def resolve_styling(
    residue: list[MappedResidue],
    options: Optional[dict[str, Any]] = None,
    *,
    provider: Optional[LLMProvider] = None,
    cache: Optional[ResolutionCache] = None,
    syntax_check: Optional[Callable[[str], int]] = None,
) -> list[Resolution]:
    """Resolve a batch of styling residue through the three-tier ladder.

    Callable from the emit pipeline, but **not yet wired into it** — wiring
    arrives with the Validator repair loop. A shared ``cache`` across the batch
    is what makes recurring residue (the same ``hover:`` in seven files) cost at
    most one LLM call.
    """
    resolver = StylingResolver(
        options, provider=provider, cache=cache, syntax_check=syntax_check
    )
    out: list[Resolution] = []
    for item in residue:
        out.extend(resolver.resolve(item))
    return out
