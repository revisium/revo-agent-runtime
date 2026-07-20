import { AGENT_RUNTIME_LIMITS } from '../../policy/index.js';
import type { AgentValidationDetails, AgentValidationDiagnostic } from '../../spec/index.js';
import type { ValidationDiagnosticInput } from './validation-diagnostic-input.js';

const encoder = new TextEncoder();

const utf8ByteLength = (value: string): number => encoder.encode(value).byteLength;

const truncateToUtf8Bytes = (value: string, maximumBytes: number): string => {
  let result = '';
  let resultBytes = 0;

  for (const codePoint of value) {
    const codePointBytes = utf8ByteLength(codePoint);
    if (resultBytes + codePointBytes > maximumBytes) break;

    result += codePoint;
    resultBytes += codePointBytes;
  }

  return result;
};

const truncateJsonPointer = (
  value: string,
): { readonly value: string; readonly truncated: boolean } => {
  let result = value;
  let truncated = false;

  while (utf8ByteLength(result) > AGENT_RUNTIME_LIMITS.diagnosticPathBytes) {
    const tokenStart = result.lastIndexOf('/');
    result = tokenStart > 0 ? result.slice(0, tokenStart) : '';
    truncated = true;
  }

  return { value: result, truncated };
};

const normalizeDiagnostic = (input: ValidationDiagnosticInput): AgentValidationDiagnostic => {
  const instancePath = truncateJsonPointer(input.instancePath);
  const schemaPath = truncateJsonPointer(input.schemaPath);

  return {
    instancePath: instancePath.value,
    instancePathTruncated: instancePath.truncated,
    schemaPath: schemaPath.value,
    schemaPathTruncated: schemaPath.truncated,
    keyword: truncateToUtf8Bytes(input.keyword, AGENT_RUNTIME_LIMITS.diagnosticKeywordBytes),
    message: truncateToUtf8Bytes(input.message, AGENT_RUNTIME_LIMITS.diagnosticMessageBytes),
  };
};

const compareUtf8 = (left: string, right: string): number => {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  for (const [index, leftByte] of leftBytes.entries()) {
    const rightByte = rightBytes[index];
    if (rightByte === undefined) return 1;

    const difference = leftByte - rightByte;
    if (difference !== 0) return difference;
  }

  return leftBytes.byteLength - rightBytes.byteLength;
};

const compareDiagnostics = (
  left: AgentValidationDiagnostic,
  right: AgentValidationDiagnostic,
): number => {
  const stringFields: readonly (keyof Pick<
    AgentValidationDiagnostic,
    'instancePath' | 'schemaPath' | 'keyword' | 'message'
  >)[] = ['instancePath', 'schemaPath', 'keyword', 'message'];

  for (const field of stringFields) {
    const difference = compareUtf8(left[field], right[field]);
    if (difference !== 0) return difference;
  }

  if (left.instancePathTruncated !== right.instancePathTruncated) {
    return left.instancePathTruncated ? 1 : -1;
  }

  if (left.schemaPathTruncated !== right.schemaPathTruncated) {
    return left.schemaPathTruncated ? 1 : -1;
  }

  return 0;
};

const detailsByteLength = (
  diagnostics: readonly AgentValidationDiagnostic[],
  truncated: boolean,
): number =>
  utf8ByteLength(
    JSON.stringify({
      diagnostics: diagnostics.map((diagnostic) => ({
        instancePath: diagnostic.instancePath,
        instancePathTruncated: diagnostic.instancePathTruncated,
        keyword: diagnostic.keyword,
        message: diagnostic.message,
        schemaPath: diagnostic.schemaPath,
        schemaPathTruncated: diagnostic.schemaPathTruncated,
      })),
      truncated,
    }),
  );

export const normalizeValidationDiagnostics = (
  inputs: readonly ValidationDiagnosticInput[],
): AgentValidationDetails => {
  const normalized = inputs.map(normalizeDiagnostic).sort(compareDiagnostics);
  const diagnostics: AgentValidationDiagnostic[] = [];

  for (const diagnostic of normalized) {
    if (diagnostics.length === AGENT_RUNTIME_LIMITS.diagnosticCount) break;

    const candidate = [...diagnostics, diagnostic];
    const truncated = candidate.length < normalized.length;
    if (detailsByteLength(candidate, truncated) > AGENT_RUNTIME_LIMITS.faultDetailsBytes) break;

    diagnostics.push(Object.freeze(diagnostic));
  }

  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    truncated: diagnostics.length < normalized.length,
  });
};
