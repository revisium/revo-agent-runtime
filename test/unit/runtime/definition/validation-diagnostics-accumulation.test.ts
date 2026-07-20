import { expect, test } from 'vitest';

import {
  normalizeValidationDiagnostics,
  type ValidationDiagnosticInput,
} from '../../../../src/runtime/definition/index.js';
import type {
  AgentValidationDetails,
  AgentValidationDiagnostic,
} from '../../../../src/runtime/spec/index.js';

const encoder = new TextEncoder();

const input = (
  instancePath: string,
  schemaPath: string,
  keyword: string,
  message: string,
): ValidationDiagnosticInput => ({ instancePath, schemaPath, keyword, message });

const diagnostic = (source: ValidationDiagnosticInput): AgentValidationDiagnostic => ({
  instancePath: source.instancePath,
  instancePathTruncated: false,
  schemaPath: source.schemaPath,
  schemaPathTruncated: false,
  keyword: source.keyword,
  message: source.message,
});

const projectedDetailsBytes = (
  diagnostics: readonly AgentValidationDiagnostic[],
  truncated: boolean,
): number =>
  encoder.encode(
    JSON.stringify({
      diagnostics: diagnostics.map((entry) => ({
        instancePath: entry.instancePath,
        instancePathTruncated: entry.instancePathTruncated,
        keyword: entry.keyword,
        message: entry.message,
        schemaPath: entry.schemaPath,
        schemaPathTruncated: entry.schemaPathTruncated,
      })),
      truncated,
    }),
  ).byteLength;

const expectedDetails = (
  diagnostics: readonly AgentValidationDiagnostic[],
  truncated: boolean,
): AgentValidationDetails => ({ diagnostics, truncated });

const boundaryPrefix = (index: string): string => `/${index}${'\0'.repeat(1_022)}`;

const boundaryDiagnostics = (): readonly ValidationDiagnosticInput[] =>
  ['0', '1', '2'].map((index) =>
    input(boundaryPrefix(index), boundaryPrefix(index), '\0'.repeat(128), '\0'.repeat(1_024)),
  );

const fourthDiagnostic = (message: string): ValidationDiagnosticInput =>
  input(`/3${'\0'.repeat(112)}`, `/3${'\0'.repeat(112)}`, '', message);

const fifthDiagnostic = (): ValidationDiagnosticInput => input('/4', '/4', '', 'omitted');

const FINAL_EXACT_LIMIT_MESSAGE = `${'\0'.repeat(1_022)}a`;
const FINAL_OVER_LIMIT_MESSAGE = `${'\0'.repeat(1_022)}aa`;
const PENDING_EXACT_LIMIT_MESSAGE = FINAL_OVER_LIMIT_MESSAGE;
const PENDING_OVER_LIMIT_MESSAGE = `${'\0'.repeat(1_022)}a"`;

test('accepts sixteen diagnostics and omits the seventeenth by count', () => {
  const inputs = Array.from({ length: 17 }, (_, index) =>
    input(`/${index.toString().padStart(2, '0')}`, '/schema', 'keyword', 'message'),
  );
  const result = normalizeValidationDiagnostics(inputs);

  expect(result).toEqual(expectedDetails(inputs.slice(0, 16).map(diagnostic), true));
});

test('returns frozen empty details for empty input', () => {
  const result = normalizeValidationDiagnostics([]);
  expect(result).toEqual(expectedDetails([], false));
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.diagnostics)).toBe(true);
});

test('preserves duplicate diagnostics and isolates the returned result from caller mutation', () => {
  const first = {
    instancePath: '/duplicate',
    schemaPath: '/schema',
    keyword: 'keyword',
    message: 'message',
  };
  const inputs = [first, first];
  const result = normalizeValidationDiagnostics(inputs);
  const expected = expectedDetails([diagnostic(first), diagnostic(first)], false);

  first.message = 'changed by caller';
  inputs.push(input('/later', '/schema', 'keyword', 'message'));

  expect(result).toEqual(expected);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.diagnostics)).toBe(true);
  expect(Object.isFrozen(result.diagnostics[0])).toBe(true);
});

test.each([
  ['final exact limit', FINAL_EXACT_LIMIT_MESSAGE, false, false, 65_536, 4],
  ['final over limit', FINAL_OVER_LIMIT_MESSAGE, false, false, 65_537, 3],
  ['pending exact limit', PENDING_EXACT_LIMIT_MESSAGE, true, true, 65_536, 4],
  ['pending over limit', PENDING_OVER_LIMIT_MESSAGE, true, true, 65_537, 3],
] as const)(
  'uses prospective truncated=%s byte accounting',
  (_name, fourthMessage, prospectiveTruncated, hasFifth, expectedBytes, acceptedCount) => {
    const firstThree = boundaryDiagnostics();
    const fourth = fourthDiagnostic(fourthMessage);
    const inputs = hasFifth ? [...firstThree, fourth, fifthDiagnostic()] : [...firstThree, fourth];
    const firstFourDiagnostics = [...firstThree, fourth].map(diagnostic);

    expect(projectedDetailsBytes(firstFourDiagnostics, prospectiveTruncated)).toBe(expectedBytes);

    const result = normalizeValidationDiagnostics(inputs);
    const accepted = firstFourDiagnostics.slice(0, acceptedCount);
    expect(result).toEqual(expectedDetails(accepted, acceptedCount !== inputs.length));
  },
);

test('projects only the six permitted diagnostic fields', () => {
  const inputWithForbiddenData = {
    instancePath: '/safe-instance',
    schemaPath: '/safe-schema',
    keyword: 'safe_keyword',
    message: 'Safe package message.',
    instanceValue: 'INSTANCE_VALUE_SENTINEL',
    schemaValue: 'SCHEMA_VALUE_SENTINEL',
    params: { marker: 'VALIDATOR_PARAMS_SENTINEL' },
  };

  const details = normalizeValidationDiagnostics([inputWithForbiddenData]);
  expect(details).toEqual(
    expectedDetails(
      [
        {
          instancePath: '/safe-instance',
          instancePathTruncated: false,
          schemaPath: '/safe-schema',
          schemaPathTruncated: false,
          keyword: 'safe_keyword',
          message: 'Safe package message.',
        },
      ],
      false,
    ),
  );

  const normalized = details.diagnostics[0];
  if (normalized === undefined) throw new Error('Expected one normalized diagnostic');
  expect(Object.keys(normalized)).toEqual([
    'instancePath',
    'instancePathTruncated',
    'schemaPath',
    'schemaPathTruncated',
    'keyword',
    'message',
  ]);
  const serialized = JSON.stringify(details);
  expect(serialized).not.toContain('INSTANCE_VALUE_SENTINEL');
  expect(serialized).not.toContain('SCHEMA_VALUE_SENTINEL');
  expect(serialized).not.toContain('VALIDATOR_PARAMS_SENTINEL');
});
