import type * as acp from '@agentclientprotocol/sdk';
import { expect, test } from 'vitest';

import {
  mapAcpElicitationRequest,
  mapAcpPermissionRequest,
} from '../../../../src/protocol/acp/session/interaction/mapping.js';

const elicitation = (requestedSchema: unknown, mode: string = 'form') =>
  ({ message: 'Choose.', mode, requestedSchema }) as acp.CreateElicitationRequest;

test('maps permission options while preserving optional tool metadata', () => {
  expect(
    mapAcpPermissionRequest('req_permission', {
      options: [{ kind: 'allow_once', name: 'Allow', optionId: 'allow' }],
      sessionId: 'session',
      toolCall: { kind: 'edit', status: 'pending', title: 'Edit', toolCallId: 'tool' },
    }),
  ).toEqual({
    action: { kind: 'edit', title: 'Edit' },
    kind: 'permission',
    options: [{ kind: 'allow_once', label: 'Allow', optionId: 'allow' }],
    requestId: 'req_permission',
  });
  expect(
    mapAcpPermissionRequest('req_minimal', {
      options: [],
      sessionId: 'session',
      toolCall: { kind: null, status: 'pending', title: null, toolCallId: 'tool' },
    }),
  ).toEqual({
    action: { kind: 'other' },
    kind: 'permission',
    options: [],
    requestId: 'req_minimal',
  });
});

test('maps every supported structured input question', () => {
  expect(
    mapAcpElicitationRequest(
      'req_input',
      elicitation({
        properties: {
          boolean: { title: 'Confirm', type: 'boolean' },
          integer: { maximum: 5, minimum: 1, title: 'Retries', type: 'integer' },
          multipleEnum: { items: { enum: ['tests', 'docs'] }, type: 'array' },
          multipleTitled: {
            items: { anyOf: [{ const: 'api', title: 'API' }] },
            type: 'array',
          },
          number: { maximum: 2.5, minimum: 0, type: 'number' },
          numberUnbounded: { type: 'number' },
          singleEnum: { enum: ['fast', 'safe'], type: 'string' },
          singleTitled: { oneOf: [{ const: 'yes', title: 'Yes' }], type: 'string' },
          text: { maxLength: 100, minLength: 1, title: 'Explanation', type: 'string' },
        },
        required: ['boolean', 'multipleEnum', 'text'],
        type: 'object',
      }),
    ),
  ).toMatchObject({
    kind: 'input',
    message: 'Choose.',
    questions: [
      { input: 'boolean', questionId: 'boolean', required: true, title: 'Confirm' },
      { input: 'number', integer: true, maximum: 5, minimum: 1, questionId: 'integer' },
      { input: 'select', questionId: 'multipleEnum', selection: 'multiple' },
      { input: 'select', questionId: 'multipleTitled', selection: 'multiple' },
      { input: 'number', integer: false, maximum: 2.5, minimum: 0, questionId: 'number' },
      { input: 'number', integer: false, questionId: 'numberUnbounded' },
      { input: 'select', questionId: 'singleEnum', selection: 'single' },
      { input: 'select', questionId: 'singleTitled', selection: 'single' },
      {
        input: 'text',
        maxLength: 100,
        minLength: 1,
        questionId: 'text',
        required: true,
        title: 'Explanation',
      },
    ],
    requestId: 'req_input',
  });
});

test('uses safe text defaults when optional numeric constraints are malformed', () => {
  expect(
    mapAcpElicitationRequest(
      'req_text',
      elicitation({
        properties: { text: { maxLength: Number.NaN, minLength: '1', type: 'string' } },
        required: [1],
        type: 'object',
      }),
    ),
  ).toEqual({
    kind: 'input',
    message: 'Choose.',
    questions: [
      {
        input: 'text',
        maxLength: 65_536,
        multiline: false,
        questionId: 'text',
        required: false,
        title: 'text',
      },
    ],
    requestId: 'req_text',
  });
});

test.each([
  ['unsupported mode', elicitation({ type: 'object' }, 'url')],
  ['non-record schema', elicitation(null)],
  ['non-record properties', elicitation({ properties: [], type: 'object' })],
  ['non-record property', elicitation({ properties: { value: null }, type: 'object' })],
  ['non-string property type', elicitation({ properties: { value: { type: 1 } }, type: 'object' })],
  [
    'unknown property type',
    elicitation({ properties: { value: { type: 'object' } }, type: 'object' }),
  ],
  [
    'array without items',
    elicitation({ properties: { value: { type: 'array' } }, type: 'object' }),
  ],
  [
    'array without options',
    elicitation({ properties: { value: { items: {}, type: 'array' } }, type: 'object' }),
  ],
  [
    'invalid array enum',
    elicitation({
      properties: { value: { items: { enum: ['ok', 1] }, type: 'array' } },
      type: 'object',
    }),
  ],
] as const)('rejects unsupported elicitation shape: %s', (_label, request) => {
  expect(mapAcpElicitationRequest('req_invalid', request)).toBeUndefined();
});

test('treats an invalid optional string enum as free text', () => {
  expect(
    mapAcpElicitationRequest(
      'req_invalid_enum',
      elicitation({
        properties: { value: { oneOf: [{ const: 'ok' }], type: 'string' } },
        type: 'object',
      }),
    ),
  ).toMatchObject({ questions: [{ input: 'text', questionId: 'value' }] });
});

test('accepts an empty form as an empty structured input request', () => {
  expect(mapAcpElicitationRequest('req_empty', elicitation({ type: 'object' }))).toEqual({
    kind: 'input',
    message: 'Choose.',
    questions: [],
    requestId: 'req_empty',
  });
});
