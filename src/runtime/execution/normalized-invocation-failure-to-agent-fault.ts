import { AGENT_FAULT_MESSAGES } from '../policy/index.js';
import type { AgentFault, AgentValidationDetails, JsonObject, JsonValue } from '../spec/index.js';
import type { NormalizedInvocationFailure } from './normalized-invocation-failure.js';

const MESSAGE_BY_CODE: Readonly<Record<AgentFault['code'], string>> = Object.freeze({
  'revo.agent.active_state_failed': AGENT_FAULT_MESSAGES.activeStateFailed,
  'revo.agent.protocol_failed': AGENT_FAULT_MESSAGES.protocolFailed,
  'revo.agent.output_write_failed': AGENT_FAULT_MESSAGES.outputWriteFailed,
  'revo.agent.process_failed': AGENT_FAULT_MESSAGES.processFailed,
  'revo.agent.process_identity_failed': AGENT_FAULT_MESSAGES.processIdentityFailed,
  'revo.agent.process_cleanup_failed': AGENT_FAULT_MESSAGES.processCleanupFailed,
  'revo.agent.result_missing': AGENT_FAULT_MESSAGES.resultMissing,
  'revo.agent.result_too_large': AGENT_FAULT_MESSAGES.resultTooLarge,
  'revo.agent.result_invalid_json': AGENT_FAULT_MESSAGES.resultInvalidJson,
  'revo.agent.result_not_object': AGENT_FAULT_MESSAGES.resultNotObject,
  'revo.agent.result_schema_mismatch': AGENT_FAULT_MESSAGES.resultSchemaMismatch,
  'revo.agent.scratch_cleanup_failed': AGENT_FAULT_MESSAGES.scratchCleanupFailed,
  'revo.agent.internal': AGENT_FAULT_MESSAGES.internalConstruction,
  'revo.agent.cancelled': AGENT_FAULT_MESSAGES.cancelled,
  'revo.agent.timeout': AGENT_FAULT_MESSAGES.timeout,
  'revo.agent.definition_invalid': AGENT_FAULT_MESSAGES.definitionInvalid,
  'revo.agent.definition_duplicate': AGENT_FAULT_MESSAGES.definitionDuplicate,
  'revo.agent.strategy_unsupported': AGENT_FAULT_MESSAGES.strategyUnsupported,
  'revo.agent.limit_invalid': AGENT_FAULT_MESSAGES.limitInvalid,
  'revo.agent.agent_unknown': AGENT_FAULT_MESSAGES.agentUnknown,
  'revo.agent.invocation_invalid': AGENT_FAULT_MESSAGES.invocationInvalid,
  'revo.agent.invocation_duplicate': AGENT_FAULT_MESSAGES.invocationDuplicate,
  'revo.agent.invocation_unknown': AGENT_FAULT_MESSAGES.invocationUnknown,
  'revo.agent.workspace_invalid': AGENT_FAULT_MESSAGES.workspaceInvalid,
  'revo.agent.parameters_invalid': AGENT_FAULT_MESSAGES.parametersInvalid,
  'revo.agent.permissions_invalid': AGENT_FAULT_MESSAGES.permissionsInvalid,
  'revo.agent.result_schema_invalid': AGENT_FAULT_MESSAGES.resultSchemaInvalid,
  'revo.agent.environment_invalid': AGENT_FAULT_MESSAGES.environmentInvalid,
  'revo.agent.output_path_invalid': AGENT_FAULT_MESSAGES.outputPathInvalid,
  'revo.agent.output_conflict': AGENT_FAULT_MESSAGES.outputConflict,
  'revo.agent.scratch_failed': AGENT_FAULT_MESSAGES.scratchFailed,
  'revo.agent.spawn_failed': AGENT_FAULT_MESSAGES.spawnFailed,
  'revo.agent.authentication_failed': AGENT_FAULT_MESSAGES.authenticationFailed,
  'revo.agent.permission_denied': AGENT_FAULT_MESSAGES.permissionDenied,
  'revo.agent.manager_not_initialized': AGENT_FAULT_MESSAGES.managerNotInitialized,
  'revo.agent.manager_closed': AGENT_FAULT_MESSAGES.managerClosed,
  'revo.agent.shutdown_failed': AGENT_FAULT_MESSAGES.shutdownFailed,
  'revo.agent.recovery_invalid': AGENT_FAULT_MESSAGES.recoveryInvalid,
  'revo.agent.recovery_failed': AGENT_FAULT_MESSAGES.recoveryFailed,
  'revo.agent.platform_unsupported': AGENT_FAULT_MESSAGES.platformUnsupported,
  'revo.agent.probe_platform_unsupported': AGENT_FAULT_MESSAGES.probePlatformUnsupported,
  'revo.agent.probe_spawn_failed': AGENT_FAULT_MESSAGES.probeStartFailed,
  'revo.agent.probe_timeout': AGENT_FAULT_MESSAGES.probeTimeout,
  'revo.agent.probe_output_too_large': AGENT_FAULT_MESSAGES.probeOutputTooLarge,
  'revo.agent.probe_process_failed': AGENT_FAULT_MESSAGES.probeProcessFailed,
  'revo.agent.probe_output_invalid': AGENT_FAULT_MESSAGES.probeOutputInvalid,
  'revo.agent.probe_version_mismatch': AGENT_FAULT_MESSAGES.probeVersionMismatch,
});

const messageFor = (code: AgentFault['code']): string => MESSAGE_BY_CODE[code];

// Phase reflects which stage OWNS the failure's reporting, not literally what operation failed — e.g.
// a duplex-coordinator-owned cleanup failure during postacceptance drainage reports 'running' because
// the coordinator owns that whole phase, matching the existing sibling cancelled/timeout-fault convention.
const phaseFor = (failure: NormalizedInvocationFailure): AgentFault['phase'] => {
  switch (failure.kind) {
    case 'finalization':
      return 'finalizing';
    case 'parser':
    case 'result_schema':
      return 'collecting_result';
    case 'duplex':
      switch (failure.primary.kind) {
        case 'parser_failed':
        case 'result_schema_failed':
          return 'collecting_result';
        case 'attach_failed':
        case 'stdin_write_failed':
        case 'stdin_end_failed':
        case 'stdout_sink_failed':
        case 'stderr_sink_failed':
        case 'protocol_sink_failed':
        case 'process_failed':
        case 'duplex_operation_timeout':
        case 'process_cleanup_failed':
        case 'internal':
          return 'running';
      }
      throw new Error('Unhandled duplex primary failure.');
  }
  throw new Error('Unhandled normalized invocation failure.');
};

const diagnosticsDetails = (
  diagnostics: AgentValidationDetails | undefined,
): JsonObject | undefined => {
  if (diagnostics === undefined) return undefined;
  const copiedDiagnostics = diagnostics.diagnostics.map((diagnostic) =>
    Object.freeze({
      instancePath: diagnostic.instancePath,
      instancePathTruncated: diagnostic.instancePathTruncated,
      schemaPath: diagnostic.schemaPath,
      schemaPathTruncated: diagnostic.schemaPathTruncated,
      keyword: diagnostic.keyword,
      message: diagnostic.message,
    }),
  ) satisfies readonly JsonValue[];
  return Object.freeze({
    schemaDiagnostics: Object.freeze({
      diagnostics: Object.freeze(copiedDiagnostics),
      truncated: diagnostics.truncated,
    }),
  });
};

export const toAgentFault = (failure: NormalizedInvocationFailure): AgentFault => {
  const details =
    failure.kind === 'result_schema' ? diagnosticsDetails(failure.diagnostics) : undefined;
  return Object.freeze({
    code: failure.code,
    message: messageFor(failure.code),
    phase: phaseFor(failure),
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
};
