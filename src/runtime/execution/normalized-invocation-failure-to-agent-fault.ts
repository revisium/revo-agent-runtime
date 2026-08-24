import { AGENT_FAULT_MESSAGES } from '../policy/index.js';
import type { AgentFault, AgentValidationDetails, JsonObject, JsonValue } from '../spec/index.js';
import type { NormalizedInvocationFailure } from './normalized-invocation-failure.js';

const messageFor = (code: AgentFault['code']): string => {
  switch (code) {
    case 'revo.agent.protocol_failed':
      return AGENT_FAULT_MESSAGES.protocolFailed;
    case 'revo.agent.output_write_failed':
      return AGENT_FAULT_MESSAGES.outputWriteFailed;
    case 'revo.agent.process_failed':
      return AGENT_FAULT_MESSAGES.processFailed;
    case 'revo.agent.process_cleanup_failed':
      return AGENT_FAULT_MESSAGES.processCleanupFailed;
    case 'revo.agent.result_missing':
      return AGENT_FAULT_MESSAGES.resultMissing;
    case 'revo.agent.result_too_large':
      return AGENT_FAULT_MESSAGES.resultTooLarge;
    case 'revo.agent.result_invalid_json':
      return AGENT_FAULT_MESSAGES.resultInvalidJson;
    case 'revo.agent.result_not_object':
      return AGENT_FAULT_MESSAGES.resultNotObject;
    case 'revo.agent.result_schema_mismatch':
      return AGENT_FAULT_MESSAGES.resultSchemaMismatch;
    case 'revo.agent.scratch_cleanup_failed':
      return AGENT_FAULT_MESSAGES.scratchCleanupFailed;
    case 'revo.agent.internal':
      return AGENT_FAULT_MESSAGES.internalConstruction;
    case 'revo.agent.cancelled':
      return AGENT_FAULT_MESSAGES.cancelled;
    case 'revo.agent.timeout':
      return AGENT_FAULT_MESSAGES.timeout;
    case 'revo.agent.definition_invalid':
      return AGENT_FAULT_MESSAGES.definitionInvalid;
    case 'revo.agent.definition_duplicate':
      return AGENT_FAULT_MESSAGES.definitionDuplicate;
    case 'revo.agent.strategy_unsupported':
      return AGENT_FAULT_MESSAGES.strategyUnsupported;
    case 'revo.agent.limit_invalid':
      return AGENT_FAULT_MESSAGES.limitInvalid;
    case 'revo.agent.agent_unknown':
      return AGENT_FAULT_MESSAGES.agentUnknown;
    case 'revo.agent.manager_closed':
      return AGENT_FAULT_MESSAGES.managerClosed;
    case 'revo.agent.shutdown_failed':
      return AGENT_FAULT_MESSAGES.shutdownFailed;
    case 'revo.agent.platform_unsupported':
      return AGENT_FAULT_MESSAGES.platformUnsupported;
    case 'revo.agent.probe_platform_unsupported':
      return AGENT_FAULT_MESSAGES.probePlatformUnsupported;
    case 'revo.agent.probe_spawn_failed':
      return AGENT_FAULT_MESSAGES.probeStartFailed;
    case 'revo.agent.probe_timeout':
      return AGENT_FAULT_MESSAGES.probeTimeout;
    case 'revo.agent.probe_output_too_large':
      return AGENT_FAULT_MESSAGES.probeOutputTooLarge;
    case 'revo.agent.probe_process_failed':
      return AGENT_FAULT_MESSAGES.probeProcessFailed;
    case 'revo.agent.probe_output_invalid':
      return AGENT_FAULT_MESSAGES.probeOutputInvalid;
    case 'revo.agent.probe_version_mismatch':
      return AGENT_FAULT_MESSAGES.probeVersionMismatch;
  }
  throw new Error('Unhandled agent fault code.');
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
    phase: 'execution',
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
};
