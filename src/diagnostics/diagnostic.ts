import type { JsonObject, JsonValue } from '../contracts/agent-definition.js';

const maxDiagnosticText = 2_048;
const maxDiagnosticBytes = 8_192;

const diagnosticText = (value: string): string =>
  value
    .replace(/(Bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]');

const diagnosticByteLength = (value: JsonValue): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Applies the final byte budget to diagnostics that crossed a fault boundary. */
export const sanitizeDiagnosticDetails = (details: JsonObject): JsonObject => {
  const budget = { remaining: maxDiagnosticBytes };
  const stderr = typeof details.stderr === 'string' ? details.stderr : undefined;
  const input = stderr === undefined ? details : { ...details, stderr: '' };
  const candidate: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(input).slice(0, 16))
    candidate[key] =
      key === 'provider' && isJsonObject(value) ? value : safeValue(value, 0, budget);
  if (stderr !== undefined) candidate.stderr = stderr;
  if (diagnosticByteLength(candidate) <= maxDiagnosticBytes) return candidate;
  const fallback: Record<string, JsonValue> = {
    message:
      typeof candidate.message === 'string'
        ? diagnosticText(candidate.message).slice(0, maxDiagnosticText)
        : 'Provider diagnostic exceeded the size limit.',
  };
  if (typeof candidate.name === 'string')
    fallback.name = diagnosticText(candidate.name).slice(0, maxDiagnosticText);
  if (typeof candidate.code === 'string' || typeof candidate.code === 'number')
    fallback.code = candidate.code;
  return fallback;
};

export const redactDiagnosticDetails = (
  details: JsonObject,
  redact: (value: string) => string,
): JsonObject => {
  const redactObject = (value: JsonObject): JsonObject => {
    const object: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) object[key] = redactValue(entry);
    return object;
  };
  const redactValue = (value: JsonValue): JsonValue => {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(redactValue);
    if (isJsonObject(value)) return redactObject(value);
    return value;
  };
  return redactObject(details);
};

/** Converts provider exceptions into a small, JSON-safe diagnostic envelope. */
export const protocolFailureDetails = (
  error: unknown,
  redact?: (value: string) => string,
): JsonObject => {
  const budget = { remaining: maxDiagnosticBytes };
  if (error instanceof Error) return finishDiagnostic(errorDetails(error, budget, redact), redact);
  if (typeof error === 'string') return { message: boundedWithBudget(error, budget, redact) };
  if (typeof error !== 'object' || error === null)
    return { message: boundedWithBudget(String(error), budget, redact) };
  const details = objectDetails(error, budget, redact);
  return Object.keys(details).length === 0
    ? { message: 'Provider request failed.' }
    : finishDiagnostic(details, redact);
};

const finishDiagnostic = (details: JsonObject, redact?: (value: string) => string): JsonObject =>
  sanitizeDiagnosticDetails(
    redact === undefined ? details : redactDiagnosticDetails(details, redact),
  );

const errorDetails = (
  error: Error,
  budget: { remaining: number },
  redact?: (value: string) => string,
): JsonObject => {
  const details: Record<string, JsonValue> = {
    name: boundedWithBudget(error.name, budget, redact),
    message: boundedWithBudget(error.message, budget, redact, maxDiagnosticBytes),
  };
  if ('code' in error) {
    const code = error.code;
    if (typeof code === 'string' || typeof code === 'number') details.code = code;
  }
  if ('data' in error && error.data !== undefined)
    details.data = safeValue(error.data, 0, budget, redact);
  return details;
};

const objectDetails = (
  error: object,
  budget: { remaining: number },
  redact?: (value: string) => string,
): JsonObject => {
  const details: Record<string, JsonValue> = {};
  for (const key of ['code', 'message', 'name'] as const) {
    const value = providerField(error, key);
    if (typeof value === 'string' || typeof value === 'number')
      details[key] = typeof value === 'string' ? boundedWithBudget(value, budget, redact) : value;
  }
  if ('data' in error && error.data !== undefined)
    details.data = safeValue(error.data, 0, budget, redact);
  return details;
};

const providerField = (error: object, key: 'code' | 'message' | 'name'): unknown => {
  if (key === 'code') return 'code' in error ? error.code : undefined;
  if (key === 'message') return 'message' in error ? error.message : undefined;
  return 'name' in error ? error.name : undefined;
};

const sensitiveKey = /token|secret|password|api[-_]?key|authorization|cookie/i;

const isJsonObject = (value: JsonValue): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedWithBudget = (
  value: string,
  budget: { remaining: number },
  redact?: (value: string) => string,
  limit = maxDiagnosticText,
): string => {
  const output = diagnosticText(redact?.(value) ?? value).slice(
    0,
    Math.min(limit, Math.max(0, budget.remaining)),
  );
  budget.remaining -= output.length;
  return output;
};

const safeValue = (
  value: unknown,
  depth: number,
  budget: { remaining: number },
  redact?: (value: string) => string,
): JsonValue => {
  if (budget.remaining <= 0) return '[diagnostic limit reached]';
  if (depth >= 3) return '[nested diagnostic omitted]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return boundedWithBudget(value, budget, redact);
  if (Array.isArray(value))
    return value.slice(0, 8).map((entry) => safeValue(entry, depth + 1, budget, redact));
  if (typeof value !== 'object') return '[diagnostic value omitted]';
  const object: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 16))
    object[key] = sensitiveKey.test(key)
      ? '[redacted]'
      : safeValue(entry, depth + 1, budget, redact);
  return object;
};
