"""CSS Module resolver — contracts.

``ParsedCss`` mirrors the Node ``css.js`` parser output (postcss AST, reduced to
simple class rules). ``CssModuleResolution`` is the resolver's answer: the RN
``StyleSheet`` object it built, the reference-rewrite it implies, the warnings
for anything dropped, and the tier distribution — the same honest provenance the
styling resolver reports.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.transformation import TransformWarning


class CssBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CssDecl(CssBase):
    prop: str
    value: str


class CssRule(CssBase):
    selector: str
    className: str
    pseudo: Optional[str] = None
    decls: list[CssDecl] = Field(default_factory=list)


class ParsedCss(CssBase):
    rules: list[CssRule] = Field(default_factory=list)
    unsupportedSelectors: list[str] = Field(default_factory=list)


class RnStyle(CssBase):
    """One RN style object: a StyleSheet key and its resolved props.

    ``pressed`` marks a ``:hover`` → pressed-state variant (key ``<name>Pressed``);
    the emit side applies it via ``Pressable``'s ``pressed`` render-prop.
    """

    name: str                       # StyleSheet key, e.g. 'card' or 'cardPressed'
    props: dict[str, Any] = Field(default_factory=dict)
    pressed: bool = False


class CssModuleResolution(CssBase):
    module: str                     # the .module.css specifier
    styles: list[RnStyle] = Field(default_factory=list)
    styleSheetBody: str = ""        # JS object literal: { card: {...}, thumb: {...} }
    styleSheetSource: str = ""      # const styles = StyleSheet.create({...});
    warnings: list[TransformWarning] = Field(default_factory=list)
    tiers: dict[str, int] = Field(default_factory=dict)  # static_map/pattern/llm
    notes: list[str] = Field(default_factory=list)

    @property
    def llmCalls(self) -> int:
        return self.tiers.get("llm", 0)
