import type { JsonObject } from './json.js';

export interface AgentValidationDiagnostic extends JsonObject {
  readonly instancePath: string;
  readonly instancePathTruncated: boolean;
  readonly schemaPath: string;
  readonly schemaPathTruncated: boolean;
  readonly keyword: string;
  readonly message: string;
}

export interface AgentValidationDetails extends JsonObject {
  readonly diagnostics: readonly AgentValidationDiagnostic[];
  readonly truncated: boolean;
}

export type M1FaultCode =
  | 'revo.agent.definition_invalid'
  | 'revo.agent.definition_duplicate'
  | 'revo.agent.strategy_unsupported'
  | 'revo.agent.limit_invalid'
  | 'revo.agent.agent_unknown'
  | 'revo.agent.probe_platform_unsupported'
  | 'revo.agent.probe_spawn_failed'
  | 'revo.agent.probe_timeout'
  | 'revo.agent.probe_output_too_large'
  | 'revo.agent.probe_process_failed'
  | 'revo.agent.probe_output_invalid'
  | 'revo.agent.probe_version_mismatch'
  | 'revo.agent.internal';

export interface AgentFault {
  readonly code: M1FaultCode;
  readonly message: string;
  readonly phase: 'construction' | 'probing';
  readonly retryable: boolean;
  readonly details?: JsonObject;
}

export class AgentManagerError extends Error {
  constructor(readonly fault: AgentFault) {
    super(fault.message);
    this.name = 'AgentManagerError';
  }
}

export const M1_FAULT_MESSAGES = Object.freeze({
  definitionInvalid: 'Agent definition is invalid.',
  invalidUnicode: 'Agent definition contains invalid Unicode.',
  definitionDuplicate: 'Agent definition reference is duplicated.',
  strategyUnsupported: 'Agent strategy is unsupported.',
  limitInvalid: 'Agent manager limit is invalid.',
  agentUnknown: 'Agent reference is unknown.',
  probePlatformUnsupported: 'Agent platform is unsupported.',
  probeExecutableUnavailable: 'Agent executable is unavailable.',
  probeStartFailed: 'Agent version probe could not start.',
  probeTimeout: 'Agent version probe timed out.',
  probeOutputTooLarge: 'Agent version probe output exceeded its limit.',
  probeProcessFailed: 'Agent version probe exited unsuccessfully.',
  probeOutputInvalid: 'Agent version probe output is invalid.',
  probeVersionMismatch: 'Agent executable version does not satisfy its constraint.',
  internalConstruction: 'Agent manager construction failed unexpectedly.',
  internalProbe: 'Agent probe failed unexpectedly.',
} as const);
