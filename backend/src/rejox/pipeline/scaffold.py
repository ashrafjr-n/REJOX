"""Scaffold generator.

Generates a fresh **Expo (TypeScript)** project skeleton from the answered Ask
questions. Deterministic, template-driven, no source code copied — just the
project shell wired for the chosen styling engine and navigation library.

Getting the NativeWind babel/metro wiring right is the common failure point, so
those live as real template files under ``templates/`` and are asserted in the
tests.

    generate_scaffold(out_dir, answers, source_dependencies) -> ScaffoldResult
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"

# Base Expo dependency set (recent, coherent SDK).
_BASE_DEPS = {
    "expo": "~52.0.0",
    # expo-asset is a transitive dep of expo, but npm frequently nests it under
    # expo/node_modules where @expo/metro-config's shallow `require.resolve
    # ('expo-asset')` cannot find it ("required package expo-asset cannot be
    # found"). Declaring it directly hoists it so Metro can start.
    "expo-asset": "~11.0.5",
    "expo-status-bar": "~2.0.0",
    "react": "18.3.1",
    "react-native": "0.76.5",
}
_BASE_DEV_DEPS = {
    "@babel/core": "^7.25.0",
    "@types/react": "~18.3.12",
    "typescript": "^5.3.3",
}
# Source deps that carry over unchanged when present, whether or not the
# emitted code happens to import them in a way we scanned. The real carry-over
# is `extra_packages`, which the emitter derives from the module specifiers of
# the files it actually wrote — a package is installed because the output uses
# it, not because it was on a list.
_CARRY_OVER = ("zustand", "axios")

# Packages REJOX ITSELF introduces — the transforms emit an import for one, so
# the output depends on a package that appears in no uploaded package.json.
# Carry-over cannot supply these: it reads the version off the source project,
# and a web project has never heard of AsyncStorage. Without an explicit pin the
# import resolves to nothing and Metro fails on it, so the pin lives here, next
# to the SDK versions it has to agree with.
_REJOX_INTRODUCED = {
    # Expo SDK 52's own bundled version (expo/bundledNativeModules.json), not a
    # guess — this is the one `expo install` would pick.
    "@react-native-async-storage/async-storage": "1.23.1",
    # MMKV is not an Expo module, so there is no bundled pin to inherit. The 2.x
    # line is deliberate: 3.x requires react-native-nitro-modules as a peer, so
    # answering "mmkv" would silently pull in a SECOND native package. 2.x runs
    # on both architectures with one.
    "react-native-mmkv": "^2.12.2",
}

# A carried-over version comes from an uploaded `package.json`, so it is
# untrusted input, not a constant. npm accepts far more than semver in that
# position — `https://…/x.tgz`, `git+ssh://…`, `file:../../` — each of which
# makes `npm install` fetch and place code of the uploader's choosing. Only
# plain registry ranges carry over; anything else falls back to our pin.
_SEMVER_RANGE_RE = re.compile(r"^[\^~]?\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$")

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _safe_version(spec: str) -> str | None:
    """Return ``spec`` when it is a plain registry range, else ``None``."""
    spec = spec.strip()
    return spec if _SEMVER_RANGE_RE.match(spec) else None


@dataclass
class ScaffoldResult:
    out_dir: Path
    files: list[str] = field(default_factory=list)
    dependencies: dict[str, str] = field(default_factory=dict)
    dev_dependencies: dict[str, str] = field(default_factory=dict)
    overrides: dict[str, str] = field(default_factory=dict)


def _slug(name: str) -> str:
    return _SLUG_RE.sub("-", name.strip().lower()).strip("-") or "rejox-app"


def _render(template_name: str, subs: dict[str, str]) -> str:
    text = (TEMPLATES_DIR / template_name).read_text()
    for key, value in subs.items():
        text = text.replace(f"{{{{{key}}}}}", value)
    return text


def _build_dependencies(
    styling: str, navigation: str | None, source_deps: dict[str, str],
    extra_packages: tuple[str, ...] = (),
) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    deps = dict(_BASE_DEPS)
    dev = dict(_BASE_DEV_DEPS)
    overrides: dict[str, str] = {}

    if styling == "nativewind":
        deps["nativewind"] = "^4.1.23"
        dev["tailwindcss"] = "^3.4.17"
        # NativeWind pulls react-native-css-interop, whose loose reanimated peer
        # otherwise resolves to a bleeding-edge version that drags in a SECOND,
        # incompatible react-native (0.86) nested under nativewind. That nested
        # copy captures NativeWind's `declare module "react-native"` className
        # augmentation, so `className` silently disappears from the app's core
        # components at type-check time. Pin reanimated to the Expo-52-compatible
        # line and force a single react-native so the augmentation lands.
        deps["react-native-reanimated"] = "~3.16.2"
        # react-native-css-interop's babel preset unconditionally references
        # `react-native-worklets/plugin`, so the package must be present for
        # Metro to transform any file — otherwise bundling dies with
        # "Cannot find module 'react-native-worklets/plugin'".
        deps["react-native-worklets"] = "^0.10.0"
        overrides["react-native"] = _BASE_DEPS["react-native"]
        overrides["react-native-reanimated"] = "~3.16.2"
        # react-native-worklets pulls @react-native/metro-config@0.86 → metro
        # 0.84, which npm hoists over Expo 52's metro 0.81.5. Expo's CLI is pinned
        # to 0.81 (`metro/src/lib/TerminalReporter`), so the mismatch breaks
        # `expo export`. Force worklets' metro-config to the RN-0.76 line so the
        # whole metro toolchain dedupes to a single 0.81.5.
        overrides["@react-native/metro-config"] = "0.76.5"

    if navigation == "react-navigation":
        deps["@react-navigation/native"] = "^7.0.0"
        deps["@react-navigation/native-stack"] = "^7.1.0"
        # Bottom-tabs ships so the chosen navigator SHAPE (stack or tabs) always
        # resolves; it is pure JS on the same v7 line and needs no native setup.
        deps["@react-navigation/bottom-tabs"] = "^7.2.0"
        deps["react-native-screens"] = "~4.4.0"
        deps["react-native-safe-area-context"] = "~4.12.0"
    elif navigation == "expo-router":
        deps["expo-router"] = "~4.0.0"
        deps["react-native-screens"] = "~4.4.0"
        deps["react-native-safe-area-context"] = "~4.12.0"
        deps["expo-linking"] = "~7.0.0"
        deps["expo-constants"] = "~17.0.0"

    for lib in (*_CARRY_OVER, *extra_packages):
        if lib in deps or lib in dev:
            # The scaffold already pins this one to a version it knows works
            # with the target SDK (react, react-native, tailwindcss…). A range
            # from the uploaded package.json must never override that pin —
            # `react: ^18.2.0` from a web project would quietly float off the
            # version React Native 0.76 requires.
            continue
        pinned = _REJOX_INTRODUCED.get(lib)
        if pinned is not None:
            # Ours, not the uploader's: the source project never declared it,
            # so there is nothing to carry over and nothing to distrust.
            deps[lib] = pinned
            continue
        spec = source_deps.get(lib)
        if spec is None:
            # Nothing to install it from. The project imports a package its own
            # package.json never declared, so there is no version to carry; the
            # unresolvable module says so at bundle time.
            continue
        safe = _safe_version(spec)
        # An unsafe spec (tarball / git / file) is never carried over. The
        # dependency is simply left out, so the failure surfaces loudly as an
        # unresolved module instead of quietly installing what was asked for.
        if safe is not None:
            deps[lib] = safe

    return dict(sorted(deps.items())), dict(sorted(dev.items())), dict(sorted(overrides.items()))


def generate_scaffold(
    out_dir: Path,
    answers: dict[str, str],
    source_dependencies: dict[str, str] | None = None,
    app_name: str = "Rejox App",
    extra_packages: tuple[str, ...] = (),
) -> ScaffoldResult:
    """Render an Expo TS scaffold into ``out_dir`` from the answered questions.

    Args:
        out_dir: Directory to write the scaffold into (created if missing).
        answers: questionId → optionId (e.g. ``{"styling-engine": "nativewind"}``).
        source_dependencies: the source project's deps, for carry-over versions.
        app_name: Human-facing app name.
        extra_packages: source packages this project's emitted code needs on
            top of the standard carry-over set (e.g. the package a lifted
            root provider is imported from).
    """
    source_deps = source_dependencies or {}
    styling = answers.get("styling-engine", "stylesheet")
    navigation = answers.get("navigation-library")
    nativewind = styling == "nativewind"
    slug = _slug(app_name)

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    deps, dev, overrides = _build_dependencies(
        styling, navigation, source_deps, extra_packages
    )
    written: list[str] = []

    def write(rel: str, content: str) -> None:
        target = out_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        written.append(rel)

    main = "expo-router/entry" if navigation == "expo-router" else "index.ts"

    # package.json
    write("package.json", _render("package.json.tmpl", {
        "APP_SLUG": slug,
        "MAIN": main,
        "DEPENDENCIES": json.dumps(deps, indent=2).replace("\n", "\n  "),
        "DEV_DEPENDENCIES": json.dumps(dev, indent=2).replace("\n", "\n  "),
        "OVERRIDES": json.dumps(overrides, indent=2).replace("\n", "\n  "),
    }))

    # app.json
    plugins = json.dumps(["expo-router"]) if navigation == "expo-router" else "[]"
    write("app.json", _render("app.json.tmpl", {
        "APP_NAME": app_name,
        "APP_SLUG": slug,
        "PLUGINS": plugins,
    }))

    # tsconfig.json
    includes = ["**/*.ts", "**/*.tsx", "expo-env.d.ts"]
    if nativewind:
        includes.append("nativewind-env.d.ts")
    write("tsconfig.json", _render("tsconfig.json.tmpl", {
        "TS_INCLUDE": json.dumps(includes),
    }))

    # babel.config.js
    if nativewind:
        babel_presets = (
            '      ["babel-preset-expo", { jsxImportSource: "nativewind" }],\n'
            '      "nativewind/babel",'
        )
    else:
        babel_presets = '      "babel-preset-expo",'
    write("babel.config.js", _render("babel.config.js.tmpl", {
        "BABEL_PRESETS": babel_presets,
    }))

    # metro.config.js
    if nativewind:
        metro_imports = 'const { withNativeWind } = require("nativewind/metro");'
        metro_export = 'withNativeWind(config, { input: "./global.css" })'
    else:
        metro_imports = ""
        metro_export = "config"
    write("metro.config.js", _render("metro.config.js.tmpl", {
        "METRO_IMPORTS": metro_imports,
        "METRO_EXPORT": metro_export,
    }))

    # Ambient types for static assets. Always written: the web shim that
    # declared these (vite-env.d.ts) is deliberately never migrated.
    write("expo-env.d.ts", _render("expo-env.d.ts.tmpl", {}))

    # NativeWind extras
    if nativewind:
        write("global.css", _render("global.css.tmpl", {}))
        write("tailwind.config.js", _render("tailwind.config.js.tmpl", {}))
        write("nativewind-env.d.ts", _render("nativewind-env.d.ts.tmpl", {}))

    # Entry points (skeleton only)
    if navigation == "expo-router":
        css_import = 'import "../global.css";\n' if nativewind else ""
        write("app/_layout.tsx",
              f'{css_import}import {{ Stack }} from "expo-router";\n\n'
              "export default function RootLayout() {\n"
              "  return <Stack />;\n}\n")
        write("app/index.tsx",
              'import { Text, View } from "react-native";\n\n'
              "export default function Index() {\n"
              '  return (\n    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>\n'
              f"      <Text>{app_name} — scaffold ready</Text>\n"
              "    </View>\n  );\n}\n")
    else:
        css_import = 'import "./global.css";\n' if nativewind else ""
        write("App.tsx", _render("App.tsx.tmpl", {
            "APP_CSS_IMPORT": css_import,
            "APP_NAME": app_name,
        }))
        write("index.ts", _render("index.ts.tmpl", {}))

    # Empty src/ tree mirroring the source layout.
    for sub in ("components", "screens", "store", "api", "hooks"):
        write(f"src/{sub}/.gitkeep", "")

    # A minimal .gitignore for the generated project.
    write(".gitignore", "node_modules/\n.expo/\ndist/\n*.log\n")

    return ScaffoldResult(
        out_dir=out_dir,
        files=sorted(written),
        dependencies=deps,
        dev_dependencies=dev,
        overrides=overrides,
    )
