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

// --- Plan / Ask stage -------------------------------------------------------
export type PlanResponse = Schemas['PlanResponse']
export type MigrationPlan = Schemas['MigrationPlan']
export type PlanStep = Schemas['PlanStep']
export type StepKind = PlanStep['kind']
export type Effort = PlanStep['estimatedEffort']
export type StepFinding = Schemas['StepFinding']
export type Question = Schemas['Question']
export type QuestionOption = Schemas['QuestionOption']
export type QuestionDependency = Schemas['QuestionDependency']
export type ManualReviewCandidate = Schemas['ManualReviewCandidate']
export type UnsupportedItem = Schemas['UnsupportedItem']

// --- Migrate job + SSE stream -----------------------------------------------
export type JobCreated = Schemas['JobCreated']
export type JobState = Schemas['JobState']
export type JobStatus = JobState['status']

// Session — the browser's half of identity (the cookie itself is httpOnly).
export type SessionState = Schemas['SessionState']
export type MigrationEvent = Schemas['MigrationEvent']
export type MigrationEventData = Schemas['MigrationEventData']
export type MigrationEventType = MigrationEvent['type']
export type MigrationStage = MigrationEvent['stage']
export type MigrationResult = Schemas['MigrationResult']
export type MigrationError = Schemas['MigrationError']
export type ValidatedScores = Schemas['ValidatedScores']

// --- Request / misc shapes --------------------------------------------------
export type SourceRequest = Schemas['SourceRequest']
export type MigrateRequest = Schemas['MigrateRequest']
export type HealthResponse = Schemas['HealthResponse']
export type ValidationError = Schemas['ValidationError']
