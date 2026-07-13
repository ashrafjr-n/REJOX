"""Domain Risk Assessment.

Classifies *functional domains* — a level of abstraction the other rules don't
have (they see libraries and components; this sees capabilities: "this app
does authentication / payments / maps").

Detection is EVIDENCE-BASED from the Knowledge Graph, never keyword-guessing
on file names: a domain triggers only on a **dependency** signal or an
**API-endpoint / route** signal. Component names and web-API usage are
corroborating evidence only — recorded when a domain already triggered, never
sufficient alone. Domains with no signal are simply absent, never "unknown".

Overall project Risk = the worst detected domain risk; "low" when no domain is
detected (documented rule, see ``overall_risk``).
"""

from __future__ import annotations

import re
from typing import TypedDict

from app.models.analysis import DomainRisk, Evidence, RiskLevel
from app.models.knowledge_graph import KnowledgeGraph


class DomainSpec(TypedDict):
    domain: str
    risk: RiskLevel
    reason: str
    rnNotes: str
    # --- triggering signals (any one is sufficient) ---
    deps: frozenset[str]        # exact dependency names
    depPrefixes: tuple[str, ...]  # scoped-package prefixes, e.g. "@stripe/"
    endpointPatterns: tuple[str, ...]  # regexes over endpoint URLs AND route paths
    # --- corroborating signals (recorded as evidence, never trigger alone) ---
    webApis: frozenset[str]
    componentNamePatterns: tuple[str, ...]


def _spec(
    domain: str,
    risk: RiskLevel,
    reason: str,
    rnNotes: str,
    deps: tuple[str, ...] = (),
    depPrefixes: tuple[str, ...] = (),
    endpointPatterns: tuple[str, ...] = (),
    webApis: tuple[str, ...] = (),
    componentNamePatterns: tuple[str, ...] = (),
) -> DomainSpec:
    return {
        "domain": domain,
        "risk": risk,
        "reason": reason,
        "rnNotes": rnNotes,
        "deps": frozenset(deps),
        "depPrefixes": depPrefixes,
        "endpointPatterns": endpointPatterns,
        "webApis": frozenset(webApis),
        "componentNamePatterns": componentNamePatterns,
    }


# The single source of truth for functional-domain risk. Data only.
DOMAIN_TABLE: tuple[DomainSpec, ...] = (
    _spec(
        "authentication",
        "high",
        "Auth flows change shape on mobile: token storage, redirects and "
        "session handling all differ from the web.",
        "Use expo-secure-store/Keychain instead of cookies or localStorage; "
        "OAuth needs deep-link redirect URIs; consider biometrics "
        "(expo-local-authentication). There are no HTTP-only cookies in RN.",
        deps=(
            "firebase", "@supabase/supabase-js", "next-auth", "jwt-decode",
            "oidc-client-ts", "keycloak-js",
        ),
        depPrefixes=("@auth0/", "@clerk/", "@okta/", "@aws-amplify/"),
        endpointPatterns=(
            r"/(login|logout|sign-?in|sign-?up|register|auth|token|oauth|session)s?(/|$|\?)",
        ),
        webApis=("localStorage", "sessionStorage"),
        componentNamePatterns=(r"(Login|Logout|SignIn|SignUp|Register|Auth)",),
    ),
    _spec(
        "payments",
        "high",
        "Payment SDKs are platform-specific and app-store rules constrain "
        "in-app purchases.",
        "Use @stripe/stripe-react-native (or platform IAP); web checkout "
        "redirects must become native payment sheets or in-app browsers.",
        deps=("stripe", "braintree-web", "@adyen/adyen-web", "@square/web-sdk"),
        depPrefixes=("@stripe/", "@paypal/"),
        endpointPatterns=(
            r"/(checkout|payments?|charges?|billing|invoices?|subscri(be|ptions?))(/|$|\?)",
        ),
        componentNamePatterns=(r"(Checkout|Payment|Billing)",),
    ),
    _spec(
        "file-upload",
        "high",
        "There is no <input type=\"file\"> on mobile; picking files/photos is "
        "a native permission-gated flow.",
        "Use expo-image-picker / expo-document-picker and multipart uploads; "
        "request camera/library permissions explicitly.",
        deps=("react-dropzone", "filepond", "react-filepond", "uppy"),
        depPrefixes=("@uppy/",),
        endpointPatterns=(r"/(upload|files?|attachments?)(/|$|\?)",),
        componentNamePatterns=(r"(Upload|Dropzone|FilePicker)",),
    ),
    _spec(
        "maps",
        "medium",
        "Web map SDKs are DOM-based; the RN equivalent has a different API "
        "surface and needs platform API keys.",
        "Use react-native-maps (Google/Apple maps) or @rnmapbox/maps; "
        "marker/overlay APIs differ from Leaflet/Mapbox GL JS.",
        deps=("leaflet", "react-leaflet", "mapbox-gl", "react-map-gl", "google-map-react"),
        depPrefixes=("@googlemaps/", "@vis.gl/react-google-maps", "@rnmapbox/"),
        endpointPatterns=(r"maps\.googleapis\.com", r"api\.mapbox\.com"),
        componentNamePatterns=(r"(Map|Marker)",),
    ),
    _spec(
        "realtime",
        "medium",
        "WebSocket lifecycles interact with app backgrounding and mobile "
        "network switching.",
        "socket.io-client and plain WebSocket work in RN, but reconnect/"
        "heartbeat logic must handle app-state changes (AppState).",
        deps=("socket.io-client", "pusher-js", "ably", "@microsoft/signalr", "phoenix", "centrifuge"),
        endpointPatterns=(r"^wss?://", r"/(socket|ws)(/|$|\?)"),
        componentNamePatterns=(r"(Live|Realtime|Socket)",),
    ),
    _spec(
        "media",
        "medium",
        "HTML <video>/<audio> and web media SDKs have no RN equivalent; "
        "playback is a native module.",
        "Use expo-av / expo-video (or react-native-video); HLS/DRM support "
        "differs per platform.",
        deps=("react-player", "video.js", "hls.js", "plyr", "wavesurfer.js", "howler"),
        endpointPatterns=(r"\.(m3u8|mpd)(\?|$)",),
        componentNamePatterns=(r"(Video|Audio|Player)",),
    ),
    _spec(
        "animations",
        "medium",
        "Web animation engines (DOM/CSS-based) do not run in RN; animations "
        "must be re-authored.",
        "framer-motion → Moti / react-native-reanimated; CSS transitions → "
        "Animated/Reanimated; Lottie works via lottie-react-native.",
        deps=("framer-motion", "react-spring", "gsap", "animejs", "motion", "lottie-web", "lottie-react"),
        depPrefixes=("@react-spring/",),
        componentNamePatterns=(r"(Animation|Motion)",),
    ),
    _spec(
        "charts",
        "low",
        "Chart libraries are SVG/canvas-based on the web; RN equivalents "
        "exist with similar APIs.",
        "Use victory-native or react-native-svg-charts (both on "
        "react-native-svg); most chart configs port with small changes.",
        deps=("recharts", "chart.js", "react-chartjs-2", "victory", "d3", "highcharts", "apexcharts", "echarts"),
        depPrefixes=("@nivo/",),
        componentNamePatterns=(r"(Chart|Graph|Sparkline)",),
    ),
    _spec(
        "i18n",
        "low",
        "i18n libraries are mostly platform-neutral; only locale detection "
        "differs on mobile.",
        "i18next/react-intl run in RN; replace browser locale detection with "
        "expo-localization.",
        deps=("i18next", "react-i18next", "react-intl", "next-intl", "polyglot"),
        depPrefixes=("@lingui/",),
        componentNamePatterns=(r"(Locale|Translat)",),
    ),
)

_RISK_ORDER: dict[RiskLevel, int] = {"low": 0, "medium": 1, "high": 2}


def _match_dependencies(spec: DomainSpec, kg: KnowledgeGraph) -> list[Evidence]:
    hits = []
    for dep in sorted(kg.project.dependencies):
        if dep in spec["deps"] or any(dep.startswith(p) for p in spec["depPrefixes"]):
            hits.append(Evidence(file="package.json", detail=f"dependency: {dep}"))
    return hits


def _match_endpoints(spec: DomainSpec, kg: KnowledgeGraph) -> list[Evidence]:
    hits = []
    patterns = [re.compile(p, re.IGNORECASE) for p in spec["endpointPatterns"]]
    if not patterns:
        return hits
    for endpoint in kg.apiLayer.endpoints:
        if endpoint.url and any(p.search(endpoint.url) for p in patterns):
            method = endpoint.method or "?"
            hits.append(
                Evidence(file=endpoint.file, detail=f"endpoint: {method} {endpoint.url}")
            )
    for route in kg.routes:
        if route.path and any(p.search(route.path) for p in patterns):
            hits.append(Evidence(file=route.file, detail=f"route: {route.path}"))
    return hits


def _corroborating(spec: DomainSpec, kg: KnowledgeGraph) -> list[Evidence]:
    hits = []
    name_patterns = [re.compile(p) for p in spec["componentNamePatterns"]]
    for comp in kg.components:
        matched_apis = spec["webApis"].intersection(comp.webApis)
        if matched_apis:
            hits.append(
                Evidence(
                    file=comp.file,
                    detail=f"web API in {comp.name}: {', '.join(sorted(matched_apis))}",
                )
            )
        if any(p.search(comp.name) for p in name_patterns):
            hits.append(Evidence(file=comp.file, detail=f"component name: {comp.name}"))
    return hits


def detect_domains(kg: KnowledgeGraph) -> list[DomainRisk]:
    """Detect functional domains — triggered by dependency or API/route
    evidence only; component names / web APIs merely corroborate."""
    detected: list[DomainRisk] = []
    for spec in DOMAIN_TABLE:
        triggering = _match_dependencies(spec, kg) + _match_endpoints(spec, kg)
        if not triggering:
            continue  # absent, never "unknown"
        detected.append(
            DomainRisk(
                domain=spec["domain"],
                risk=spec["risk"],
                reason=spec["reason"],
                rnNotes=spec["rnNotes"],
                evidence=triggering + _corroborating(spec, kg),
            )
        )
    return sorted(detected, key=lambda d: (-_RISK_ORDER[d.risk], d.domain))


def overall_risk(domains: list[DomainRisk]) -> RiskLevel:
    """The documented rule: overall Risk = worst detected domain risk
    ("low" when no domain is detected)."""
    if not domains:
        return "low"
    return max((d.risk for d in domains), key=lambda r: _RISK_ORDER[r])
