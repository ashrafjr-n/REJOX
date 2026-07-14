/**
 * Named aliases over the backend's OpenAPI schema.
 *
 * The real shapes live in `api.generated.ts`, produced by `npm run types:gen`
 * from the FastAPI `/openapi.json` — never hand-written. This file exists only
 * to give component code readable names (`AnalysisReport` instead of
 * `components["schemas"]["AnalysisReport"]`). If a shape looks wrong, fix the
 * backend model and regenerate; do not edit types here.
 */
import type { components } from './api.generated'

type Schemas = components['schemas']

// --- Ingest (Upload stage) --------------------------------------------------
export type CandidateRoot = Schemas['CandidateRoot']
export type IngestedProject = Schemas['IngestedProject']
export type IngestSource = IngestedProject['source']

// --- Shared enums (derived from the fields that use them) --------------------
export type Severity = Schemas['Issue']['severity']
export type LibraryCategory = Schemas['LibraryFinding']['category']
export type LibraryStatus = Schemas['LibraryFinding']['status']
export type Difficulty = Schemas['ComponentFinding']['difficulty']
export type RiskLevel = Schemas['AnalysisReport']['risk']

// --- Analysis models --------------------------------------------------------
export type Evidence = Schemas['Evidence']
export type Issue = Schemas['Issue']
export type RnEquivalent = Schemas['RnEquivalent']
export type LibraryFinding = Schemas['LibraryFinding']
export type ComponentFinding = Schemas['ComponentFinding']
export type RouteMapping = Schemas['RouteMapping']
export type RoutingReport = Schemas['RoutingReport']
export type StylingReport = Schemas['StylingReport']
export type DomainRisk = Schemas['DomainRisk']
export type Summary = Schemas['Summary']
export type ScoreContribution = Schemas['ScoreContribution']
export type AnalysisReport = Schemas['AnalysisReport']

// --- Request / misc shapes --------------------------------------------------
export type SourceRequest = Schemas['SourceRequest']
export type HealthResponse = Schemas['HealthResponse']
export type ValidationError = Schemas['ValidationError']
