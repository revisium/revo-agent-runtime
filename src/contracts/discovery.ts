import type { AgentDefinitionInput } from './agent-definition.js';

export interface DiscoveredAgentModel {
  readonly id: string;
  readonly displayName?: string;
}

export interface AgentDiscoveryCandidate {
  readonly definition: AgentDefinitionInput;
  readonly models: readonly DiscoveredAgentModel[];
  readonly defaultModelId?: string;
}

export interface AgentDiscoveryDiagnostic {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
}

export interface AgentDetectorContext {
  readonly signal: AbortSignal;
}

export interface AgentDetectorResult {
  readonly candidates: readonly AgentDiscoveryCandidate[];
  readonly diagnostics: readonly AgentDiscoveryDiagnostic[];
}

export interface AgentDetector {
  readonly id: string;
  detect(context: AgentDetectorContext): Promise<AgentDetectorResult>;
}

export interface DiscoverAgentsOptions {
  readonly includeBuiltInDetectors?: boolean;
  readonly detectors?: readonly AgentDetector[];
  readonly disabledDetectorIds?: readonly string[];
  readonly signal?: AbortSignal;
  readonly systemExecutableOverrides?: Readonly<{
    readonly codex?: string;
    readonly claude?: string;
    readonly cline?: string;
    readonly copilot?: string;
    readonly cursor?: string;
    readonly gemini?: string;
    readonly goose?: string;
    readonly grok?: string;
    readonly hermes?: string;
    readonly kilo?: string;
    readonly kimi?: string;
    readonly opencode?: string;
    readonly qwen?: string;
    readonly vibe?: string;
    readonly antigravity?: string;
  }>;
}

export interface ModelObservation {
  readonly detectorId: string;
  readonly definitionIndex: number;
  readonly models: readonly DiscoveredAgentModel[];
  readonly defaultModelId?: string;
}

export interface AgentDiscoveryResult {
  readonly definitions: readonly AgentDefinitionInput[];
  readonly diagnostics: readonly (AgentDiscoveryDiagnostic & { readonly detectorId: string })[];
  readonly modelObservations: readonly ModelObservation[];
}
