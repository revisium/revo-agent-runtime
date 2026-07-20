import { expect, test } from 'vitest';

import {
  normalizeValidationDiagnostics,
  type ValidationDiagnosticInput,
} from '../../../../src/runtime/definition/index.js';
import type { AgentValidationDetails } from '../../../../src/runtime/spec/index.js';

const ASCII_PATH_AT_LIMIT = `/${'a'.repeat(1_023)}`;
const ASCII_PATH_OVER_LIMIT = `/${'a'.repeat(1_022)}/b`;
const SINGLE_TOKEN_OVER_LIMIT = `/${'a'.repeat(1_024)}`;
const ESCAPED_TOKEN_OVER_LIMIT = `/safe/${'a'.repeat(1_015)}~0~1`;
const KEYWORD_AT_LIMIT = '😀'.repeat(32);
const KEYWORD_OVER_LIMIT = `${KEYWORD_AT_LIMIT}😀`;
const MESSAGE_AT_LIMIT = '😀'.repeat(256);
const MESSAGE_OVER_LIMIT = `${MESSAGE_AT_LIMIT}😀`;

const input = (
  instancePath: string,
  schemaPath: string,
  keyword: string,
  message: string,
): ValidationDiagnosticInput => ({ instancePath, schemaPath, keyword, message });

const expected = (
  instancePath: string,
  schemaPath: string,
  keyword: string,
  message: string,
  instancePathTruncated = false,
  schemaPathTruncated = false,
): AgentValidationDetails => ({
  diagnostics: [
    {
      instancePath,
      instancePathTruncated,
      schemaPath,
      schemaPathTruncated,
      keyword,
      message,
    },
  ],
  truncated: false,
});

test('keeps all fields that exactly meet their UTF-8 byte limits', () => {
  expect(
    normalizeValidationDiagnostics([
      input(ASCII_PATH_AT_LIMIT, ASCII_PATH_AT_LIMIT, KEYWORD_AT_LIMIT, MESSAGE_AT_LIMIT),
    ]),
  ).toEqual(expected(ASCII_PATH_AT_LIMIT, ASCII_PATH_AT_LIMIT, KEYWORD_AT_LIMIT, MESSAGE_AT_LIMIT));
});

test('removes only the final complete instance pointer token when it exceeds its byte limit', () => {
  const retainedPath = `/${'a'.repeat(1_022)}`;
  expect(
    normalizeValidationDiagnostics([input(ASCII_PATH_OVER_LIMIT, '/schema', 'keyword', 'message')]),
  ).toEqual(expected(retainedPath, '/schema', 'keyword', 'message', true));
});

test('removes only the final complete schema pointer token when it exceeds its byte limit', () => {
  const retainedPath = `/${'a'.repeat(1_022)}`;
  expect(
    normalizeValidationDiagnostics([
      input('/instance', ASCII_PATH_OVER_LIMIT, 'keyword', 'message'),
    ]),
  ).toEqual(expected('/instance', retainedPath, 'keyword', 'message', false, true));
});

test('falls back to the root pointer for a single oversized pointer token', () => {
  expect(
    normalizeValidationDiagnostics([
      input(SINGLE_TOKEN_OVER_LIMIT, '/schema', 'keyword', 'message'),
    ]),
  ).toEqual(expected('', '/schema', 'keyword', 'message', true));
});

test('removes an escaped pointer token as one unit', () => {
  expect(
    normalizeValidationDiagnostics([
      input('/instance', ESCAPED_TOKEN_OVER_LIMIT, 'keyword', 'message'),
    ]),
  ).toEqual(expected('/instance', '/safe', 'keyword', 'message', false, true));
});

test('bounds keyword and message at whole Unicode code point boundaries', () => {
  expect(
    normalizeValidationDiagnostics([
      input('/instance', '/schema', KEYWORD_OVER_LIMIT, MESSAGE_OVER_LIMIT),
    ]),
  ).toEqual(expected('/instance', '/schema', KEYWORD_AT_LIMIT, MESSAGE_AT_LIMIT));
});
