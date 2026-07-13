"""CSS Module resolver — the ladder + StyleSheet assembly.

Applies the core question to `.module.css`: *is this reasoning, or a rule?* It is
a rule. `resolve_css_module` runs the same three-tier ladder as the styling
resolver, but on real input the bottom rung is never reached:

- **static map** (`property_map.py`) — every base declaration maps (or drops) by
  rule;
- **pattern**   — a ``:hover`` block becomes a ``<name>Pressed`` variant, the
  same pressed-state idea the styling resolver uses;
- **LLM**       — only a genuinely unparseable value of a *known* RN property
  (e.g. a multi-shadow ``box-shadow``) — and only if a provider is supplied;
  otherwise it too is dropped with a warning. Nothing is ever guessed.

The output is a ``StyleSheet.create({…})`` body plus the reference rewrite the
component needs. Emit both StyleSheet (the safe deterministic target, valid
under NativeWind and plain RN alike) — the chosen engine only changes packaging.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

from app.ai.cache import ResolutionCache
from app.ai.css.models import CssModuleResolution, CssRule, ParsedCss, RnStyle
from app.ai.css.parser import parse_css_module, rewrite_component
from app.ai.css.property_map import map_declaration
from app.ai.provider import LLMProvider
from app.models.transformation import TransformWarning

_FENCE_RE = re.compile(r"^```[a-zA-Z0-9]*\n?|\n?```$", re.MULTILINE)
CSS_DECL_ISSUE = "CSS_DECL"


# --- JS serialization --------------------------------------------------------


def _js(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return f"'{value}'"
    if isinstance(value, dict):
        return "{ " + ", ".join(f"{k}: {_js(v)}" for k, v in value.items()) + " }"
    if isinstance(value, list):
        return "[" + ", ".join(_js(v) for v in value) + "]"
    return f"'{value}'"


def _style_object(props: dict[str, Any]) -> str:
    inner = ", ".join(f"{k}: {_js(v)}" for k, v in props.items())
    return "{ " + inner + " }"


def _stylesheet_body(styles: list[RnStyle]) -> str:
    lines = [f"  {s.name}: {_style_object(s.props)}," for s in styles if s.props]
    return "{\n" + "\n".join(lines) + "\n}"


# --- resolver ----------------------------------------------------------------


class CssModuleResolver:
    def __init__(
        self,
        options: Optional[dict[str, Any]] = None,
        *,
        provider: Optional[LLMProvider] = None,
        cache: Optional[ResolutionCache] = None,
    ) -> None:
        self.options = dict(options or {})
        self.provider = provider
        self.cache = cache or ResolutionCache()
        self.warnings: list[TransformWarning] = []
        self.tiers = {"static_map": 0, "pattern": 0, "llm": 0}

    def resolve(self, parsed: ParsedCss, module: str) -> CssModuleResolution:
        styles: list[RnStyle] = []
        for rule in parsed.rules:
            styles.append(self._resolve_rule(rule))
        # Complex selectors (`.a .b`, `.a > img`) can't map to a flat StyleSheet.
        for sel in parsed.unsupportedSelectors:
            self.warnings.append(TransformWarning(
                code="CSS_SELECTOR",
                message=f"selector '{sel}' is not a simple class — RN StyleSheet is flat; skipped.",
                line=0,
            ))

        styles = [s for s in styles if s.props]
        body = _stylesheet_body(styles)
        return CssModuleResolution(
            module=module,
            styles=styles,
            styleSheetBody=body,
            styleSheetSource=f"const styles = StyleSheet.create({body});",
            warnings=self.warnings,
            tiers=dict(self.tiers),
            notes=self._notes(styles),
        )

    def _resolve_rule(self, rule: CssRule) -> RnStyle:
        pressed = rule.pseudo == "hover"
        if pressed:
            self.tiers["pattern"] += 1
            name = f"{rule.className}Pressed"
        elif rule.pseudo is None:
            self.tiers["static_map"] += 1
            name = rule.className
        else:
            # Other pseudo-classes (:focus/:active) → treat like pressed but note.
            self.tiers["pattern"] += 1
            name = f"{rule.className}{rule.pseudo.capitalize()}"

        props: dict[str, Any] = {}
        for decl in rule.decls:
            result = map_declaration(decl.prop, decl.value)
            if result.props:
                props.update(dict(result.props))
            elif result.ambiguous:
                props.update(self._resolve_decl_llm(decl.prop, decl.value))
            elif result.warning:
                self.warnings.append(TransformWarning(
                    code="CSS_DROP",
                    message=f"{rule.selector} {{ {decl.prop}: {decl.value} }} — {result.warning}",
                    line=0,
                ))
            # clean_drop: nothing to do.
        return RnStyle(name=name, props=props, pressed=pressed)

    def _resolve_decl_llm(self, prop: str, value: str) -> dict[str, Any]:
        """Tier 3 — only reached for an unparseable KNOWN property. Without a
        provider, degrade to a warned drop (never guess)."""
        if self.provider is None:
            self.warnings.append(TransformWarning(
                code="CSS_DROP",
                message=f"{prop}: {value} — ambiguous; no RN mapping and no LLM available; dropped.",
                line=0,
            ))
            return {}

        snippet = f"{prop}: {value}"
        cached = self.cache.get(CSS_DECL_ISSUE, snippet, self.options)
        if cached is not None:
            self.tiers["llm"] += 1
            return self._parse_props(cached.response.code)

        system = (
            "You convert ONE CSS declaration into React Native style props. "
            "Output ONLY a JSON object of RN style props in camelCase, e.g. "
            '{"shadowColor": "#000", "shadowRadius": 4}. If it cannot be '
            "expressed, output {}."
        )
        raw = self.provider.complete(system, snippet, max_tokens=256)
        self.tiers["llm"] += 1
        code = _FENCE_RE.sub("", raw.text).strip()
        from app.ai.schemas import ResolutionResponse

        self.cache.put(
            CSS_DECL_ISSUE, snippet, self.options,
            ResolutionResponse(code=code, confidence="low"),
            model=getattr(self.provider, "model", getattr(self.provider, "model_name", "?")),
        )
        return self._parse_props(code)

    @staticmethod
    def _parse_props(code: str) -> dict[str, Any]:
        try:
            data = json.loads(code)
            return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}

    @staticmethod
    def _notes(styles: list[RnStyle]) -> list[str]:
        notes: list[str] = []
        for s in styles:
            if s.pressed:
                base = s.name[: -len("Pressed")] if s.name.endswith("Pressed") else s.name
                notes.append(
                    f"'{s.name}' is a pressed-state variant of '{base}'; apply via a "
                    f"<Pressable style={{({{ pressed }}) => [styles.{base}, pressed && styles.{s.name}]}}>."
                )
        return notes


def resolve_css_module(
    css_path: Path | str,
    *,
    module: Optional[str] = None,
    options: Optional[dict[str, Any]] = None,
    provider: Optional[LLMProvider] = None,
    cache: Optional[ResolutionCache] = None,
) -> CssModuleResolution:
    """Resolve one ``.module.css`` file into an RN ``StyleSheet``.

    ``module`` is the import specifier the component used (for the rewrite);
    defaults to ``./<filename>``. Callable from emit but not yet wired in.
    """
    parsed = parse_css_module(css_path)
    spec = module or f"./{Path(css_path).name}"
    resolver = CssModuleResolver(options, provider=provider, cache=cache)
    return resolver.resolve(parsed, spec)


def rewrite_component_source(
    component_path: Path | str, module_specifier: str, resolution: CssModuleResolution
) -> str:
    """Rewrite the component that imported the CSS module (drop import, inline
    StyleSheet, flip className→style) — the deterministic reference rewrite."""
    return rewrite_component(component_path, module_specifier, resolution.styleSheetBody)
