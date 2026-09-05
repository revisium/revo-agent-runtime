import { expect, test } from 'vitest';

import type { AgentSessionInteractiveRequest } from '../../../../../../../src/contracts/session/interaction/request.js';
import type { AgentSessionInteractiveResponse } from '../../../../../../../src/contracts/session/interaction/response.js';
import {
  sameInteractionResponse,
  validInteractionResponse,
} from '../../../../../../../src/execution/session/kernel/reducer/interaction/validation.js';

const permission: AgentSessionInteractiveRequest = {
  action: { kind: 'execute' },
  kind: 'permission',
  options: [{ kind: 'allow_once', label: 'Allow', optionId: 'allow' }],
  requestId: 'permission',
};

const input = (
  question: Extract<AgentSessionInteractiveRequest, { kind: 'input' }>['questions'][number],
): AgentSessionInteractiveRequest => ({
  kind: 'input',
  message: 'Answer.',
  questions: [question],
  requestId: 'input',
});

const submitted = (
  value: string | number | boolean | readonly string[],
): AgentSessionInteractiveResponse => ({
  kind: 'input',
  outcome: 'submitted',
  values: { answer: value },
});

test('compares interaction response discriminants and payloads exactly', () => {
  const responses: readonly [
    AgentSessionInteractiveResponse,
    AgentSessionInteractiveResponse,
    boolean,
  ][] = [
    [
      { kind: 'permission', optionId: 'allow', outcome: 'selected' },
      { kind: 'permission', optionId: 'allow', outcome: 'selected' },
      true,
    ],
    [
      { kind: 'permission', optionId: 'allow', outcome: 'selected' },
      { kind: 'permission', optionId: 'other', outcome: 'selected' },
      false,
    ],
    [{ kind: 'permission', outcome: 'denied' }, { kind: 'permission', outcome: 'denied' }, true],
    [{ kind: 'permission', outcome: 'denied' }, { kind: 'input', outcome: 'cancelled' }, false],
    [{ kind: 'input', outcome: 'declined' }, { kind: 'input', outcome: 'cancelled' }, false],
    [
      { kind: 'input', outcome: 'submitted', values: { a: 1 } },
      { kind: 'input', outcome: 'submitted', values: { a: 1, b: true } },
      false,
    ],
    [
      { kind: 'input', outcome: 'submitted', values: { a: 1 } },
      { kind: 'input', outcome: 'submitted', values: { a: 2 } },
      false,
    ],
    [
      { kind: 'input', outcome: 'submitted', values: { a: ['x', 'y'] } },
      { kind: 'input', outcome: 'submitted', values: { a: ['x', 'y'] } },
      true,
    ],
    [
      { kind: 'input', outcome: 'submitted', values: { a: ['x'] } },
      { kind: 'input', outcome: 'submitted', values: { a: ['x', 'y'] } },
      false,
    ],
    [
      { kind: 'input', outcome: 'submitted', values: { a: ['x', 'z'] } },
      { kind: 'input', outcome: 'submitted', values: { a: ['x', 'y'] } },
      false,
    ],
  ];
  for (const [left, right, expected] of responses)
    expect(sameInteractionResponse(left, right)).toBe(expected);
});

test('validates permission response identity and selection', () => {
  expect(validInteractionResponse(permission, { kind: 'permission', outcome: 'denied' })).toBe(
    true,
  );
  expect(
    validInteractionResponse(permission, {
      kind: 'permission',
      optionId: 'allow',
      outcome: 'selected',
    }),
  ).toBe(true);
  expect(
    validInteractionResponse(permission, {
      kind: 'permission',
      optionId: 'unknown',
      outcome: 'selected',
    }),
  ).toBe(false);
  expect(validInteractionResponse(permission, { kind: 'input', outcome: 'cancelled' })).toBe(false);
  expect(
    validInteractionResponse(
      input({ input: 'boolean', questionId: 'answer', required: true, title: 'Answer' }),
      {
        kind: 'permission',
        outcome: 'denied',
      },
    ),
  ).toBe(false);
});

test.each([
  [
    {
      input: 'text',
      maxLength: 4,
      multiline: false,
      questionId: 'answer',
      required: true,
      title: 'Text',
    },
    'ok',
    true,
  ],
  [
    {
      input: 'text',
      maxLength: 4,
      multiline: false,
      questionId: 'answer',
      required: true,
      title: 'Text',
    },
    '',
    false,
  ],
  [
    {
      input: 'text',
      maxLength: 4,
      multiline: false,
      questionId: 'answer',
      required: false,
      title: 'Text',
    },
    '',
    true,
  ],
  [
    {
      input: 'text',
      maxLength: 4,
      minLength: 2,
      multiline: false,
      questionId: 'answer',
      required: false,
      title: 'Text',
    },
    'x',
    false,
  ],
  [
    {
      input: 'text',
      maxLength: 4,
      multiline: false,
      questionId: 'answer',
      required: true,
      title: 'Text',
    },
    'hello',
    false,
  ],
  [
    {
      input: 'text',
      maxLength: 20,
      multiline: false,
      questionId: 'answer',
      required: true,
      title: 'Text',
    },
    'a\nb',
    false,
  ],
  [
    {
      input: 'text',
      maxLength: 20,
      multiline: false,
      questionId: 'answer',
      required: true,
      title: 'Text',
    },
    'a\rb',
    false,
  ],
  [
    {
      input: 'text',
      maxLength: 20,
      multiline: true,
      questionId: 'answer',
      required: true,
      title: 'Text',
    },
    'a\nb',
    true,
  ],
  [
    {
      input: 'text',
      maxLength: 20,
      multiline: true,
      questionId: 'answer',
      required: true,
      title: 'Text',
    },
    true,
    false,
  ],
] as const)('validates text question %#', (question, value, expected) => {
  expect(validInteractionResponse(input(question), submitted(value))).toBe(expected);
});

test.each([
  [1, true],
  [1.5, false],
  [Number.NaN, false],
  ['1', false],
  [0, false],
  [4, false],
] as const)('validates bounded integer value %s', (value, expected) => {
  const request = input({
    input: 'number',
    integer: true,
    maximum: 3,
    minimum: 1,
    questionId: 'answer',
    required: true,
    title: 'Count',
  });
  expect(validInteractionResponse(request, submitted(value))).toBe(expected);
});

test('validates unconstrained fractional numbers and booleans', () => {
  expect(
    validInteractionResponse(
      input({
        input: 'number',
        integer: false,
        questionId: 'answer',
        required: true,
        title: 'Value',
      }),
      submitted(1.5),
    ),
  ).toBe(true);
  const boolean = input({ input: 'boolean', questionId: 'answer', required: true, title: 'Flag' });
  expect(validInteractionResponse(boolean, submitted(true))).toBe(true);
  expect(validInteractionResponse(boolean, submitted('true'))).toBe(false);
});

test.each([
  ['known', true],
  ['custom', false],
  ['', false],
  [['known'], false],
] as const)('validates closed single selection %s', (value, expected) => {
  const request = input({
    allowOther: false,
    input: 'select',
    options: [{ label: 'Known', optionId: 'known' }],
    questionId: 'answer',
    required: true,
    selection: 'single',
    title: 'Choice',
  });
  expect(validInteractionResponse(request, submitted(value))).toBe(expected);
});

test('allows a non-empty custom single selection when configured', () => {
  const request = input({
    allowOther: true,
    input: 'select',
    options: [],
    questionId: 'answer',
    required: true,
    selection: 'single',
    title: 'Choice',
  });
  expect(validInteractionResponse(request, submitted('custom'))).toBe(true);
});

test.each([
  [['known'], true],
  [[], false],
  [['known', 'known'], false],
  [[''], false],
  [['unknown'], false],
  ['known', false],
] as const)('validates required closed multiple selection %s', (value, expected) => {
  const request = input({
    allowOther: false,
    input: 'select',
    options: [{ label: 'Known', optionId: 'known' }],
    questionId: 'answer',
    required: true,
    selection: 'multiple',
    title: 'Choices',
  });
  expect(validInteractionResponse(request, submitted(value))).toBe(expected);
});

test('allows optional omitted answers and custom multiple values but rejects unknown keys', () => {
  const request = input({
    allowOther: true,
    input: 'select',
    options: [],
    questionId: 'answer',
    required: false,
    selection: 'multiple',
    title: 'Choices',
  });
  expect(
    validInteractionResponse(request, { kind: 'input', outcome: 'submitted', values: {} }),
  ).toBe(true);
  expect(validInteractionResponse(request, submitted([]))).toBe(true);
  expect(validInteractionResponse(request, submitted(['custom']))).toBe(true);
  expect(
    validInteractionResponse(request, {
      kind: 'input',
      outcome: 'submitted',
      values: { unknown: 'x' },
    }),
  ).toBe(false);
  expect(validInteractionResponse(request, { kind: 'input', outcome: 'declined' })).toBe(true);
});
