"""CSS Module resolver — `.module.css` → React Native StyleSheet, by rule.

CSS Modules are a *parsing* problem, not a reasoning one: postcss (in the Node
worker) parses the stylesheet, a declarative CSS→RN table maps each declaration,
and a ts-morph rewrite flips the component's references. The LLM tier exists in
the ladder for symmetry but is not reached on real input.
"""

from app.ai.css.models import (
    CssModuleResolution,
    CssRule,
    ParsedCss,
    RnStyle,
)
from app.ai.css.resolver import (
    CssModuleResolver,
    resolve_css_module,
    rewrite_component_source,
)

__all__ = [
    "CssModuleResolution",
    "CssModuleResolver",
    "CssRule",
    "ParsedCss",
    "RnStyle",
    "resolve_css_module",
    "rewrite_component_source",
]
