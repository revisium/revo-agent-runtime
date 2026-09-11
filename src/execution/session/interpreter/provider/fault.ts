import type { JsonObject, JsonValue } from '../../../../contracts/agent-definition.js';
import type { AgentFault } from '../../../../contracts/manager/core.js';
import {
  redactDiagnosticDetails,
  sanitizeDiagnosticDetails,
  type SessionProtocolFailure,
} from '../../../../protocol/session/errors/protocol-error.js';

export const protocolFault = (
  failure: SessionProtocolFailure | undefined,
  phase: AgentFault['phase'],
  redact?: (value: string) => string,
): AgentFault => {
  let code: AgentFault['code'] = 'revo.agent.protocol_failed';
  if (failure?.code === 'configuration_stale') code = 'revo.agent.configuration_stale';
  if (failure?.code === 'configuration_value_unsupported')
    code = 'revo.agent.configuration_value_unsupported';
  if (failure?.code === 'capability_unsupported') code = 'revo.agent.session_unsupported';
  return {
    code,
    ...(failure?.details === undefined
      ? {}
      : {
          details: {
            diagnostic: {
              provider: sanitizeDiagnosticDetails(
                redact === undefined
                  ? failure.details
                  : redactDiagnosticDetails(failure.details, redact),
              ),
            },
          },
        }),
    message: 'The provider session protocol operation failed.',
    phase,
    retryable: failure?.retryable ?? false,
  };
};

export const withStderrDiagnostic = (
  fault: AgentFault,
  diagnostic: Readonly<{ readonly stderr: string; readonly truncated: boolean }>,
  redact?: (value: string) => string,
): AgentFault => {
  if (diagnostic.stderr.length === 0 && !diagnostic.truncated && redact === undefined) return fault;
  const existing = fault.details?.diagnostic;
  const diagnosticDetails: JsonObject = isJsonObject(existing) ? existing : {};
  return {
    ...fault,
    details: {
      ...(fault.details ?? {}),
      diagnostic: sanitizeDiagnosticDetails({
        ...redactObject(diagnosticDetails, redact),
        stderr: redact?.(diagnostic.stderr) ?? diagnostic.stderr,
        ...(diagnostic.truncated ? { stderrTruncated: true } : {}),
      }),
    },
  };
};

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  value !== undefined && typeof value === 'object' && value !== null && !Array.isArray(value);

const redactObject = (value: JsonObject, redact?: (value: string) => string): JsonObject => {
  if (redact === undefined) return value;
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = redactValue(entry, redact);
  return result;
};

const redactValue = (value: JsonValue, redact: (value: string) => string): JsonValue => {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((entry: JsonValue) => redactValue(entry, redact));
  if (isJsonObject(value)) return redactObject(value, redact);
  return value;
};
