"""Navigator code generation — deterministic, from a validated spec.

This is the "rules write the code" half of the navigation resolver. Given a
:class:`NavigatorSpec` (whatever chose it — a rule default or the LLM's shape
decision) and the route table, it emits a complete, syntactically valid
``AppNavigator.tsx``. It never consults an LLM and never emits a TODO: the
route table makes screen wiring mechanical.
"""

from __future__ import annotations

from app.ai.navigation.models import NavigatorSpec, NavigatorType, NestedNavigator
from app.models.analysis import RouteMapping

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


def _component_for(screen: str, routes: list[RouteMapping]) -> str | None:
    for r in routes:
        if r.screenName == screen and r.componentName:
            return r.componentName
    return None


def _nested_component(parent: str) -> str:
    return f"{parent}Navigator"


def _screen_line(var: str, name: str, component: str) -> str:
    return f'        <{var}.Screen name="{name}" component={{{component}}} />'


def _nested_navigator_block(nested: NestedNavigator, routes: list[RouteMapping]) -> tuple[str, str]:
    """(creator-var declaration, function component) for one nested navigator."""
    creator, _, prefix = _CREATORS[nested.type]
    var = f"{nested.parent}{prefix}"
    decl = f"const {var} = {creator}();"
    lines = "\n".join(
        _screen_line(var, s, _component_for(s, routes) or s) for s in nested.screens
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


def generate_navigator(spec: NavigatorSpec, routes: list[RouteMapping]) -> str:
    """Generate ``AppNavigator.tsx`` source for ``spec``. Complete, no TODO."""
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
        imports.append(f"import {comp} from '../screens/{comp}';")

    # Nested navigator components (declared before AppNavigator).
    nested_decls: list[str] = []
    nested_fns: list[str] = []
    for n in spec.nested:
        decl, fn = _nested_navigator_block(n, routes)
        nested_decls.append(decl)
        nested_fns.append(fn)

    top_var_decl = f"const {prefix} = {creator}();"
    initial = spec.screens[0]

    screen_lines = []
    for s in spec.screens:
        component = _nested_component(s) if s in nested_by_parent else (_component_for(s, routes) or s)
        screen_lines.append(_screen_line(prefix, s, component))
    screens = "\n".join(screen_lines)

    app = (
        "export function AppNavigator() {\n"
        "  return (\n"
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
