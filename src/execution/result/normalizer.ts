import type { AgentFault } from '../../contracts/manager/core.js';
import { RawResponseEvidence } from './raw-response.js';
import { compileResultSchema } from './schema-validator.js';

type ResultFailureReason =
  | 'missing_terminal'
  | 'response_empty'
  | 'response_too_large'
  | 'invalid_utf8'
  | 'invalid_json'
  | 'response_not_object'
  | 'duplicate_terminal'
  | 'schema_mismatch';

export type NormalizedResult =
  | Readonly<{
      status: 'succeeded';
      value: Record<string, unknown>;
      rawResponse: RawResponseEvidence['diagnostic'];
      evidence: RawResponseEvidence;
    }>
  | Readonly<{
      status: 'failed';
      code: AgentFault['code'];
      reason: ResultFailureReason;
      rawResponse?: RawResponseEvidence['diagnostic'];
      evidence?: RawResponseEvidence;
    }>;

const failureCodes: Readonly<Record<ResultFailureReason, AgentFault['code']>> = Object.freeze({
  duplicate_terminal: 'revo.agent.protocol_failed',
  invalid_json: 'revo.agent.result_invalid_json',
  invalid_utf8: 'revo.agent.result_invalid_json',
  missing_terminal: 'revo.agent.result_missing',
  response_empty: 'revo.agent.result_missing',
  response_not_object: 'revo.agent.result_not_object',
  response_too_large: 'revo.agent.result_too_large',
  schema_mismatch: 'revo.agent.result_schema_mismatch',
});

const failed = (reason: ResultFailureReason, evidence?: RawResponseEvidence): NormalizedResult =>
  Object.freeze({
    status: 'failed',
    code: failureCodes[reason],
    reason,
    ...(evidence === undefined ? {} : { evidence, rawResponse: evidence.diagnostic }),
  });

interface JsonScanState {
  depth: number;
  escaped: boolean;
  quoted: boolean;
}

const scanJsonCharacter = (
  state: JsonScanState,
  character: string,
  index: number,
): number | undefined => {
  if (state.quoted) {
    if (state.escaped) state.escaped = false;
    else if (character === '\\') state.escaped = true;
    else if (character === '"') state.quoted = false;
    return undefined;
  }
  if (character === '"') state.quoted = true;
  else if (character === '{' || character === '[') state.depth += 1;
  else if (character === '}' || character === ']') {
    state.depth -= 1;
    if (state.depth === 0) return index + 1;
  }
  return undefined;
};

const topLevelObjectEnd = (text: string): number | undefined => {
  const start = text.search(/\S/);
  if (start < 0 || text[start] !== '{') return undefined;
  const state: JsonScanState = { depth: 0, escaped: false, quoted: false };
  for (let index = start; index < text.length; index += 1) {
    const end = scanJsonCharacter(state, text.charAt(index), index);
    if (end !== undefined) return end;
  }
  return undefined;
};

const hasDuplicateTerminal = (text: string): boolean => {
  const end = topLevelObjectEnd(text);
  if (end === undefined) return false;
  const remainder = text.slice(end).trim();
  if (remainder.length === 0) return false;
  try {
    JSON.parse(remainder);
    return true;
  } catch {
    return false;
  }
};

const deepFreeze = (value: object): void => {
  const pending: Array<Readonly<{ expanded: boolean; value: object }>> = [
    { expanded: false, value },
  ];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.expanded) {
      Object.freeze(current.value);
      continue;
    }
    pending.push({ expanded: true, value: current.value });
    for (const key of Reflect.ownKeys(current.value)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current.value, key);
      const child: unknown = descriptor?.value;
      if (typeof child === 'object' && child !== null && !Object.isFrozen(child))
        pending.push({ expanded: false, value: child });
    }
  }
};

export const normalizeResult = (input: {
  readonly evidence: RawResponseEvidence | undefined;
  readonly schema: Readonly<Record<string, unknown>>;
}): NormalizedResult => {
  const evidence = input.evidence;
  if (evidence === undefined || evidence.observations === 0)
    return failed('missing_terminal', evidence);
  if (evidence.diagnostic.byteLength === 0) return failed('response_empty', evidence);
  if (evidence.diagnostic.truncated) return failed('response_too_large', evidence);

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(evidence.bytes());
  } catch {
    return failed('invalid_utf8', evidence);
  }
  if (hasDuplicateTerminal(text)) return failed('duplicate_terminal', evidence);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failed('invalid_json', evidence);
  }
  if (!isRecord(parsed)) return failed('response_not_object', evidence);
  const value = parsed;
  try {
    if (!compileResultSchema(input.schema).validate(value))
      return failed('schema_mismatch', evidence);
  } catch {
    return failed('schema_mismatch', evidence);
  }
  deepFreeze(value);
  return Object.freeze({ status: 'succeeded', value, rawResponse: evidence.diagnostic, evidence });
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
