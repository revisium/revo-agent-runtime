import type { AgentValidationDetails, JsonObject } from '../spec/index.js';
import { BoundedRawResponseEvidence } from './bounded-raw-response-evidence.js';
import { duplexPrimaryFailureCode } from './duplex-primary-failure-code.js';
import type { InvocationTerminalObservation } from './execution-terminal-observation.js';
import { freezeJsonValue } from './freeze-json-value.js';
import type { InterimDuplexPrimaryFailure } from './interim-duplex-primary-failure.js';
import type { NormalizedInvocationEvidence } from './normalized-invocation-evidence.js';
import { type NormalizedInvocationFailure } from './normalized-invocation-failure.js';
import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';
import { parserFailureCode } from './parser-failure-code.js';
import type { ResultSchemaValidator } from './result-schema-validator.js';

const decoder = new TextDecoder('utf-8', { fatal: true });

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const failed = (
  failure: NormalizedInvocationFailure,
  evidence: NormalizedInvocationEvidence,
): NormalizedInvocationOutcome => Object.freeze({ status: 'failed', failure, evidence });

const failParser = (
  reason: Parameters<typeof parserFailureCode>[0],
  evidence: NormalizedInvocationEvidence,
): NormalizedInvocationOutcome =>
  failed(Object.freeze({ kind: 'parser', reason, code: parserFailureCode(reason) }), evidence);

const failSchema = (
  evidence: NormalizedInvocationEvidence,
  diagnostics?: AgentValidationDetails,
): NormalizedInvocationOutcome =>
  failed(
    Object.freeze({
      kind: 'result_schema',
      code: 'revo.agent.result_schema_mismatch' as const,
      ...(diagnostics === undefined ? {} : { diagnostics }),
    }),
    Object.freeze({
      ...evidence,
      ...(diagnostics === undefined ? {} : { schemaDiagnostics: diagnostics }),
    }),
  );

const validateParsedResponse = (
  parsed: JsonObject,
  validator: ResultSchemaValidator,
  evidence: NormalizedInvocationEvidence,
): NormalizedInvocationOutcome => {
  try {
    const diagnostics = validator.validate(parsed);
    if (diagnostics !== undefined) return failSchema(evidence, diagnostics);
  } catch {
    return failSchema(evidence);
  }
  return Object.freeze({ status: 'succeeded', value: parsed, evidence });
};

const normalizePrimaryFailure = (
  primary: InterimDuplexPrimaryFailure,
  evidence: NormalizedInvocationEvidence,
): NormalizedInvocationOutcome => {
  if (primary.kind === 'parser_failed') return failParser(primary.reason, evidence);
  if (primary.kind === 'result_schema_failed')
    return failSchema(evidence, evidence.schemaDiagnostics);
  return failed(
    Object.freeze({ kind: 'duplex', primary, code: duplexPrimaryFailureCode(primary) }),
    evidence,
  );
};

const parseObjectResponse = (
  rawResponse: BoundedRawResponseEvidence | undefined,
  validator: ResultSchemaValidator,
  evidence: NormalizedInvocationEvidence,
): NormalizedInvocationOutcome => {
  const rawBytes = BoundedRawResponseEvidence.peek(rawResponse);
  if (rawResponse === undefined || rawBytes === undefined)
    return failParser('missing_terminal', evidence);
  if (rawResponse.view.byteLength === 0) return failParser('response_empty', evidence);
  if (rawResponse.view.truncated) return failParser('response_too_large', evidence);

  let text: string;
  try {
    text = decoder.decode(rawBytes);
  } catch {
    return failParser('invalid_utf8', evidence);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failParser('invalid_json', evidence);
  }
  if (!isJsonObject(parsed)) return failParser('response_not_object', evidence);

  freezeJsonValue(parsed);
  return validateParsedResponse(parsed, validator, evidence);
};

export const normalizeInvocationOutcome = (
  observation: InvocationTerminalObservation,
  validator: ResultSchemaValidator,
): NormalizedInvocationOutcome => {
  const evidence: NormalizedInvocationEvidence = Object.freeze({
    ...('exit' in observation && observation.exit !== undefined ? { exit: observation.exit } : {}),
    ...(observation.usage === undefined ? {} : { usage: observation.usage }),
    ...(observation.rawResponse === undefined ? {} : { rawResponse: observation.rawResponse }),
    ...('schemaDiagnostics' in observation && observation.schemaDiagnostics !== undefined
      ? { schemaDiagnostics: observation.schemaDiagnostics }
      : {}),
  });

  if (observation.status === 'cancelled') return Object.freeze({ status: 'cancelled', evidence });
  if (observation.status === 'cleanup_uncertain') {
    if (observation.primary.kind === 'cancelled')
      return Object.freeze({ status: 'cancelled', evidence });
    return normalizePrimaryFailure(observation.primary, evidence);
  }
  if (observation.status === 'failed')
    return normalizePrimaryFailure(observation.primary, evidence);
  if (observation.parsedResponse !== undefined)
    return validateParsedResponse(observation.parsedResponse, validator, evidence);
  return parseObjectResponse(observation.rawResponse, validator, evidence);
};
