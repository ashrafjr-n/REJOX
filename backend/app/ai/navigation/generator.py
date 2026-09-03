"""Navigator code generation — deterministic, from a validated spec.

This is the "rules write the code" half of the navigation resolver. Given a
:class:`NavigatorSpec` (whatever chose it — a rule default or the LLM's shape
decision) and the route table, it emits a complete, syntactically valid
``AppNavigator.tsx``. It never consults an LLM: the route table makes screen
wiring mechanical.

The one thing the route table cannot make mechanical is a route element that
carried props — ``<Route element={<Settings darkMode={x} />}>``. A `Screen`
registers a component, not an element, so those props have nowhere to ride
along. Where they are plain reads of the routing component's own ``useState``,
that is not a judgment call but a relocation: ``AppNavigator`` *is* what that
component's routing half becomes, so the state moves with it and the screen is
written in `Screen`'s render-callback form. Anything richer than a plain read
(a spread, a derived expression, a value from a context) leaves a
``NAV_SCREEN_PROPS`` TODO instead — see ``docs/CONVERSION-RULES.md``.
"""

from __future__ import annotations

from typing import Optional

from app.ai.navigation.models import NavigatorSpec, NavigatorType, NestedNavigator
from app.models.analysis import RouteMapping
from app.models.knowledge_graph import RouteHostState

# navigator type → (creator fn, module, JSX var prefix)
_CREATORS = {
    NavigatorType.STACK: ("createNativeStackNavigator", "@react-navigation/native-stack", "Stack"),
    NavigatorType.TABS: ("createBottomTabNavigator", "@react-navigation/bottom-tabs", "Tab"),
    NavigatorType.DRAWER: ("createDrawerNavigator", "@react-navigation/drawer", "Drawer"),
}


def stack_spec_from_routes(routes: list[RouteMapping]) -> NavigatorSpec:
    """The deterministic default (no LLM): a flat native-stack of every screen."""
    seen: list[str] = []
    for r in routes:
        if r.componentName and r.screenName not in seen:
            seen.append(r.screenName)
    return NavigatorSpec(
        type=NavigatorType.STACK,
        screens=seen or ["Home"],
        rationale="Deterministic default: a flat stack mirrors the route table exactly.",
    )


def build_navigator_spec(nav_type: str, routes: list[RouteMapping]) -> NavigatorSpec:
    """A concrete :class:`NavigatorSpec` for a chosen navigator *type*, derived
    deterministically from the route table.

    The LLM (or the user) chooses only the topology *type* (``stack``/``tabs``/
    ``drawer``); the actual screen/nesting layout is mechanical:

    - ``stack`` → a flat stack (:func:`stack_spec_from_routes`).
    - ``tabs``/``drawer`` → top-level screens are the parameter-less routes; a
      parameterized detail route (``products/:id``) nests in a stack under its
      parent list route (``products``), so deep links still push a screen.
    """
    try:
        ntype = NavigatorType(nav_type)
    except ValueError:
        ntype = NavigatorType.STACK
    if ntype is NavigatorType.STACK:
        return stack_spec_from_routes(routes)

    top: list[str] = []
    for r in routes:
        if r.componentName and ":" not in (r.path or "") and r.screenName not in top:
            top.append(r.screenName)

    nested: list[NestedNavigator] = []
    for r in routes:
        if not (r.componentName and r.params and r.path and "/" in r.path):
            continue
        parent_path = r.path.rsplit("/", 1)[0].strip("/")
        parent = next(
            (x.screenName for x in routes
             if (x.path or "").strip("/") == parent_path and x.componentName),
            None,
        )
        if parent:
            nested.append(NestedNavigator(
                type=NavigatorType.STACK, parent=parent,
                screens=[parent, r.screenName],
            ))

    if not top:  # no parameter-less routes → fall back to a flat stack
        return stack_spec_from_routes(routes)
    return NavigatorSpec(
        type=ntype, screens=top, nested=nested,
        rationale=f"Chosen {ntype.value} navigator; detail routes nest in a stack.",
    )


def _component_for(screen: str, routes: list[RouteMapping]) -> str | None:
    for r in routes:
        if r.screenName == screen and r.componentName:
            return r.componentName
    return None


def _nested_component(parent: str) -> str:
    return f"{parent}Navigator"


def _screen_line(var: str, name: str, component: str) -> str:
    return f'        <{var}.Screen name="{name}" component={{{component}}} />'


def _route_for(screen: str, routes: list[RouteMapping]) -> RouteMapping | None:
    return next((r for r in routes if r.screenName == screen), None)


def _hoistable_state(route: RouteMapping | None) -> list[RouteHostState] | None:
    """The routing component's state this screen's element props need.

    ``[]`` means the screen carried no props — an ordinary ``component={X}``
    line. ``None`` means at least one prop is not a plain read of that state, so
    nothing can be relocated and the screen owes a TODO instead.
    """
    if route is None or not route.elementProps:
        return []

    by_value = {s.value: s for s in route.hostState}
    by_setter = {s.setter: s for s in route.hostState if s.setter}

    needed: list[RouteHostState] = []
    for prop in route.elementProps:
        state = by_value.get(prop.binding) or by_setter.get(prop.binding) if prop.binding else None
        if state is None:
            return None
        if state not in needed:
            needed.append(state)
    return needed


def _state_line(state: RouteHostState) -> str:
    names = state.value if state.setter is None else f"{state.value}, {state.setter}"
    return f"  const [{names}] = useState({state.initializer});"


def _relocatable(route: RouteMapping | None, can_hoist: bool) -> list[RouteHostState] | None:
    """:func:`_hoistable_state`, narrowed by where the screen is being written.

    Only ``AppNavigator`` can hoist. A nested navigator is its own component, so
    declaring the state there would create a *second*, independent copy of it —
    two `useState`s that drift apart on the first render. A nested screen that
    carried props therefore owes the same TODO as an unresolvable one.
    """
    hoisted = _hoistable_state(route)
    if hoisted and not can_hoist:
        return None
    return hoisted


def _screen_block(
    var: str, name: str, component: str, route: RouteMapping | None, can_hoist: bool
) -> str:
    """One screen — a plain line, a render callback, or a line owing a TODO."""
    relocatable = _relocatable(route, can_hoist)

    if relocatable is None and route is not None:
        carried = ", ".join(p.name for p in route.elementProps)
        return (
            f"        {{/* REJOX-TODO(NAV_SCREEN_PROPS): the route passed {carried}; "
            f"a Screen takes a component, not an element. Lift the value to a "
            f"context/store, or pass it through initialParams. */}}\n"
            + _screen_line(var, name, component)
        )

    if not relocatable or route is None:
        return _screen_line(var, name, component)

    props = " ".join(f"{p.name}={{{p.binding}}}" for p in route.elementProps)
    return (
        f'        <{var}.Screen name="{name}">\n'
        f"          {{() => <{component} {props} />}}\n"
        f"        </{var}.Screen>"
    )


def unhoistable_screens(spec: NavigatorSpec, routes: list[RouteMapping]) -> list[str]:
    """Screens whose element props could not be relocated — one TODO each."""
    nested = [(s, False) for n in spec.nested for s in n.screens]
    top = [(s, True) for s in spec.screens]
    return [s for s, can_hoist in [*top, *nested] if _relocatable(_route_for(s, routes), can_hoist) is None]


def _nested_navigator_block(nested: NestedNavigator, routes: list[RouteMapping]) -> tuple[str, str]:
    """(creator-var declaration, function component) for one nested navigator."""
    creator, _, prefix = _CREATORS[nested.type]
    var = f"{nested.parent}{prefix}"
    decl = f"const {var} = {creator}();"
    lines = "\n".join(
        _screen_block(var, s, _component_for(s, routes) or s, _route_for(s, routes), can_hoist=False)
        for s in nested.screens
    )
    fn = (
        f"function {_nested_component(nested.parent)}() {{\n"
        f"  return (\n"
        f"    <{var}.Navigator>\n"
        f"{lines}\n"
        f"    </{var}.Navigator>\n"
        f"  );\n}}"
    )
    return decl, fn


def generate_navigator(
    spec: NavigatorSpec,
    routes: list[RouteMapping],
    import_paths: Optional[dict[str, str]] = None,
) -> str:
    """Generate ``AppNavigator.tsx`` source for ``spec``. Complete, no TODO.

    ``import_paths`` maps a component name to its real import path relative to
    ``src/navigation/``, taken from where emission actually put the file. Not
    every routed screen lives under ``pages/``: a real project routed a
    ``PageNotFound`` that sat in ``src/components/``, and assuming the
    directory produced an import to a file that was never written there.
    Anything missing from the map falls back to the ``screens/`` convention.
    """
    import_paths = import_paths or {}
    creator, module, prefix = _CREATORS[spec.type]
    nested_by_parent = {n.parent: n for n in spec.nested}

    # Components to import: every referenced screen's component.
    referenced: list[str] = []
    for s in spec.screens:
        if s in nested_by_parent:
            for ns in nested_by_parent[s].screens:
                referenced.append(_component_for(ns, routes) or ns)
        else:
            referenced.append(_component_for(s, routes) or s)
    components = sorted(set(referenced))

    # Import block.
    imports = ["import { NavigationContainer } from '@react-navigation/native';"]
    creators = {(creator, module)}
    for n in spec.nested:
        creators.add(_CREATORS[n.type][:2])
    for fn, mod in sorted(creators):
        imports.append(f"import {{ {fn} }} from '{mod}';")
    for comp in components:
        imports.append(f"import {comp} from '{import_paths.get(comp, f'../screens/{comp}')}';")

    # Nested navigator components (declared before AppNavigator).
    nested_decls: list[str] = []
    nested_fns: list[str] = []
    for n in spec.nested:
        decl, fn = _nested_navigator_block(n, routes)
        nested_decls.append(decl)
        nested_fns.append(fn)

    top_var_decl = f"const {prefix} = {creator}();"
    initial = spec.screens[0]

    # A nested parent is a generated navigator, not a route — it never carries
    # element props of its own, so it is written as a plain screen line.
    screen_lines = []
    hoisted: list[RouteHostState] = []
    for s in spec.screens:
        nested = s in nested_by_parent
        component = _nested_component(s) if nested else (_component_for(s, routes) or s)
        route = None if nested else _route_for(s, routes)
        screen_lines.append(_screen_block(prefix, s, component, route, can_hoist=True))
        for state in _relocatable(route, can_hoist=True) or []:
            if state not in hoisted:
                hoisted.append(state)
    screens = "\n".join(screen_lines)

    # The routing component's state comes with its routing half.
    if hoisted:
        imports.insert(0, "import { useState } from 'react';")
    state_block = "".join(f"{_state_line(s)}\n" for s in hoisted)

    app = (
        "export function AppNavigator() {\n"
        f"{state_block}"
        + ("\n" if state_block else "")
        + "  return (\n"
        "    <NavigationContainer>\n"
        f'      <{prefix}.Navigator initialRouteName="{initial}">\n'
        f"{screens}\n"
        f"      </{prefix}.Navigator>\n"
        "    </NavigationContainer>\n"
        "  );\n}"
    )

    blocks = ["\n".join(imports)]
    blocks.extend(nested_decls)
    blocks.extend(nested_fns)
    blocks.append(top_var_decl)
    blocks.append(app)
    return "\n\n".join(blocks) + "\n"
