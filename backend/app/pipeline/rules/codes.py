"""Stable issue codes shared across the rule modules.

These strings are part of the report contract — downstream stages and the UI key
off them, so treat them as stable identifiers.
"""

# Elements
WEB_ONLY_ELEMENT = "WEB_ONLY_ELEMENT"      # table/canvas/iframe... no RN equivalent
ELEMENT_CONVERSION = "ELEMENT_CONVERSION"  # img→Image, button→Pressable, ...

# Events
WEB_ONLY_EVENT = "WEB_ONLY_EVENT"          # onSubmit/onMouseEnter/onKeyDown...
EVENT_CONVERSION = "EVENT_CONVERSION"      # onClick→onPress, onChange→onChangeText

# Styling
HOVER_STATE = "HOVER_STATE"                # hover: utilities — no hover on touch
INTERACTION_STATE = "INTERACTION_STATE"    # focus:/active: — partial in RN
CSS_GRID = "CSS_GRID"                       # grid / grid-cols-* — no CSS grid in RN
RESPONSIVE_BREAKPOINT = "RESPONSIVE_BREAKPOINT"  # sm:/md:/lg:/xl: — needs config
GRADIENT = "GRADIENT"                       # bg-gradient/from-/to- — needs a lib
GROUP_SELECTOR = "GROUP_SELECTOR"           # group / group-hover: — no equivalent
DYNAMIC_CLASSNAME = "DYNAMIC_CLASSNAME"     # className built at runtime
CSS_MODULE = "CSS_MODULE"                   # *.module.css — manual conversion

# Layout / structure (conversion facts)
MISSING_TEXT_WRAP = "MISSING_TEXT_WRAP"    # bare text not inside <Text> — RN crash
IMPLICIT_FLEX_ROW = "IMPLICIT_FLEX_ROW"    # flex w/o direction — web=row, RN=column
UNSIZED_IMAGE = "UNSIZED_IMAGE"            # <img> without explicit size — RN needs it
RN_INCOMPATIBLE_CSS_PROP = "RN_INCOMPATIBLE_CSS_PROP"  # inline style prop RN can't do

# Source / APIs
WEB_API_USAGE = "WEB_API_USAGE"            # localStorage/window/document...

# Libraries
UNSUPPORTED_LIBRARY = "UNSUPPORTED_LIBRARY"
UNKNOWN_LIBRARY = "UNKNOWN_LIBRARY"

# Routing
ROUTER_NEEDS_CONVERSION = "ROUTER_NEEDS_CONVERSION"
OBJECT_ROUTER_UNPARSED = "OBJECT_ROUTER_UNPARSED"

# Parsing (parser-worker warnings — the graph itself is incomplete)
PARSE_FAILED = "PARSE_FAILED"    # a file never made it into the KG at all
PARSE_WARNING = "PARSE_WARNING"  # a file is in the KG but read imperfectly
