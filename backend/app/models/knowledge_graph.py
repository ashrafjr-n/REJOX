"""Knowledge Graph schema.

The Knowledge Graph is the deterministic, serializable contract produced by the
Parser stage and consumed by every later stage of the pipeline. It is emitted as
JSON by the Node parser-worker and validated here with pydantic.

Keep this file in sync with the TypeScript mirror in
``backend/parser-worker/src/types.ts``.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# --- Shared -----------------------------------------------------------------

FileType = Literal[
    "component", "hook", "store", "api", "style", "config", "asset", "other"
]
StylingApproach = Literal["tailwind", "css-module", "inline", "none"]
EdgeKind = Literal["renders", "imports", "uses-hook", "uses-store", "calls-api"]


class KGBase(BaseModel):
    """Base model: forbid unknown keys so schema drift is caught loudly."""

    model_config = ConfigDict(extra="forbid")


# --- Project ----------------------------------------------------------------


class Project(KGBase):
    name: str
    root: str
    framework: Literal["react"]
    language: Literal["ts", "js", "mixed"]
    bundler: Optional[str] = None
    dependencies: dict[str, str] = Field(default_factory=dict)


# --- Files ------------------------------------------------------------------


class FileNode(KGBase):
    path: str
    type: FileType
    loc: int


# --- Components -------------------------------------------------------------


class PropInfo(KGBase):
    name: str
    type: Optional[str] = None
    optional: bool = False


class TextNodeInfo(KGBase):
    """A raw text / expression child in JSX."""

    jsxParentTag: str
    # Static text, or the literal string "dynamic" for an expression child.
    text: str
    # True when not already inside a text-ish element (needs <Text> in RN).
    isBare: bool


class LayoutHint(KGBase):
    """Flex/grid layout info for one element."""

    elementTag: str
    hasFlexClass: bool
    flexDirection: Optional[Literal["row", "column"]] = None
    isGrid: bool


class ImageInfo(KGBase):
    """Info about one ``<img>``."""

    hasExplicitSize: bool
    srcKind: Literal["import", "literal", "dynamic"]
    src: Optional[str] = None


class InlineStyleInfo(KGBase):
    """An element carrying an inline ``style={{…}}`` object."""

    elementTag: str
    properties: list[str] = Field(default_factory=list)


class Component(KGBase):
    id: str
    name: str
    file: str
    exportType: Literal["default", "named"]
    props: list[PropInfo] = Field(default_factory=list)
    hooksUsed: list[str] = Field(default_factory=list)
    childComponents: list[str] = Field(default_factory=list)
    # host (lowercase) JSX tags → occurrence count, e.g. {"div": 4, "img": 1}
    jsxElements: dict[str, int] = Field(default_factory=dict)
    eventHandlers: list[str] = Field(default_factory=list)
    stylingApproach: list[StylingApproach] = Field(default_factory=list)
    tailwindClasses: list[str] = Field(default_factory=list)
    cssModuleImports: list[str] = Field(default_factory=list)
    # Browser globals referenced (localStorage, window, document, ...).
    webApis: list[str] = Field(default_factory=list)
    # --- Conversion facts (feed the Deterministic Transformer) ---
    textNodes: list[TextNodeInfo] = Field(default_factory=list)
    layoutHints: list[LayoutHint] = Field(default_factory=list)
    images: list[ImageInfo] = Field(default_factory=list)
    inlineStyles: list[InlineStyleInfo] = Field(default_factory=list)


# --- Hooks ------------------------------------------------------------------


class Hook(KGBase):
    id: str
    name: str
    file: str
    isCustom: bool
    usedBy: list[str] = Field(default_factory=list)


# --- Routes -----------------------------------------------------------------


class Route(KGBase):
    path: Optional[str] = None
    componentName: Optional[str] = None
    file: Optional[str] = None
    hasParams: bool = False
    params: list[str] = Field(default_factory=list)


# --- State management -------------------------------------------------------


class Store(KGBase):
    id: str
    name: str
    file: str
    stateKeys: list[str] = Field(default_factory=list)
    usedBy: list[str] = Field(default_factory=list)


class StateManagement(KGBase):
    library: Literal["zustand", "context", "none"]
    stores: list[Store] = Field(default_factory=list)


# --- API layer --------------------------------------------------------------


class ApiClient(KGBase):
    id: str
    library: Literal["axios", "fetch"]
    file: str
    baseURL: Optional[str] = None


class Endpoint(KGBase):
    method: Optional[str] = None
    url: Optional[str] = None
    file: str


class ApiLayer(KGBase):
    clients: list[ApiClient] = Field(default_factory=list)
    endpoints: list[Endpoint] = Field(default_factory=list)


# --- Assets -----------------------------------------------------------------


class Asset(KGBase):
    path: str
    type: str
    referencedBy: list[str] = Field(default_factory=list)


# --- Edges ------------------------------------------------------------------


class Edge(KGBase):
    from_: str = Field(alias="from")
    to: str
    kind: EdgeKind

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --- Root -------------------------------------------------------------------


class KnowledgeGraph(KGBase):
    project: Project
    files: list[FileNode] = Field(default_factory=list)
    components: list[Component] = Field(default_factory=list)
    hooks: list[Hook] = Field(default_factory=list)
    routes: list[Route] = Field(default_factory=list)
    stateManagement: StateManagement
    apiLayer: ApiLayer = Field(default_factory=ApiLayer)
    assets: list[Asset] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
