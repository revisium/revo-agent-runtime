import { expect, test } from 'vitest';

import {
  normalizeValidationDiagnostics,
  type ValidationDiagnosticInput,
} from '../../../../src/runtime/definition/index.js';
import type {
  AgentValidationDetails,
  AgentValidationDiagnostic,
} from '../../../../src/runtime/spec/index.js';

const input = (
  instancePath: string,
  schemaPath: string,
  keyword: string,
  message: string,
): ValidationDiagnosticInput => ({ instancePath, schemaPath, keyword, message });

const diagnostic = (
  instancePath: string,
  schemaPath: string,
  keyword: string,
  message: string,
  instancePathTruncated = false,
  schemaPathTruncated = false,
): AgentValidationDiagnostic => ({
  instancePath,
  instancePathTruncated,
  schemaPath,
  schemaPathTruncated,
  keyword,
  message,
});

const details = (diagnostics: readonly AgentValidationDiagnostic[]): AgentValidationDetails => ({
  diagnostics,
  truncated: false,
});

test('sorts instance paths by unsigned UTF-8 bytes instead of UTF-16 code units', () => {
  expect(
    normalizeValidationDiagnostics([
      input('\u{10000}', '/schema', 'keyword', 'message'),
      input('\uE000', '/schema', 'keyword', 'message'),
    ]),
  ).toEqual(
    details([
      diagnostic('\uE000', '/schema', 'keyword', 'message'),
      diagnostic('\u{10000}', '/schema', 'keyword', 'message'),
    ]),
  );
});

test('orders every string field before truncation flags', () => {
  expect(
    normalizeValidationDiagnostics([
      input('/a', '/a', 'a', 'b'),
      input('/a', '/a', 'b', 'a'),
      input('/a', '/b', 'a', 'a'),
      input('/b', '/a', 'a', 'a'),
      input('/a', '/a', 'a', 'a'),
    ]),
  ).toEqual(
    details([
      diagnostic('/a', '/a', 'a', 'a'),
      diagnostic('/a', '/a', 'a', 'b'),
      diagnostic('/a', '/a', 'b', 'a'),
      diagnostic('/a', '/b', 'a', 'a'),
      diagnostic('/b', '/a', 'a', 'a'),
    ]),
  );
});

test('sorts fields after bounding and uses message order when bounded keywords are equal', () => {
  const boundedKeyword = 'k'.repeat(128);
  expect(
    normalizeValidationDiagnostics([
      input('/same', '/same', `${boundedKeyword}z`, 'z-message'),
      input('/same', '/same', `${boundedKeyword}a`, 'a-message'),
    ]),
  ).toEqual(
    details([
      diagnostic('/same', '/same', boundedKeyword, 'a-message'),
      diagnostic('/same', '/same', boundedKeyword, 'z-message'),
    ]),
  );
});

test('places an untruncated instance path before an equally bounded truncated path', () => {
  const retainedPath = `/${'a'.repeat(1022)}`;
  expect(
    normalizeValidationDiagnostics([
      input(`${retainedPath}/b`, '/schema', 'keyword', 'message'),
      input(retainedPath, '/schema', 'keyword', 'message'),
    ]),
  ).toEqual(
    details([
      diagnostic(retainedPath, '/schema', 'keyword', 'message'),
      diagnostic(retainedPath, '/schema', 'keyword', 'message', true),
    ]),
  );
});

test('places an untruncated schema path after equal preceding fields before its truncated equivalent', () => {
  const retainedPath = `/${'a'.repeat(1022)}`;
  expect(
    normalizeValidationDiagnostics([
      input('/instance', `${retainedPath}/b`, 'keyword', 'message'),
      input('/instance', retainedPath, 'keyword', 'message'),
    ]),
  ).toEqual(
    details([
      diagnostic('/instance', retainedPath, 'keyword', 'message'),
      diagnostic('/instance', retainedPath, 'keyword', 'message', false, true),
    ]),
  );
});
