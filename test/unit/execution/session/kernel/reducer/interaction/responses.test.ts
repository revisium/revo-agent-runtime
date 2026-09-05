import { expect, test } from 'vitest';

import type { AgentSessionInteractiveRequest } from '../../../../../../../src/contracts/session/interaction/request.js';
import type { AgentSessionInteractiveResponse } from '../../../../../../../src/contracts/session/interaction/response.js';
import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import {
  inputInteractionRequest,
  permissionInteractionRequest,
  readyInteractionState,
} from '../../../../../../support/session/builders/kernel/interactions.js';

const observed = { observedAt: '2026-03-21T00:00:02.000Z', observedAtMs: 2_000 } as const;

const respond = (
  request: AgentSessionInteractiveRequest,
  response: AgentSessionInteractiveResponse,
) => {
  return reduceSession(readyInteractionState(request), {
    ...observed,
    call: { callId: 'respond_01', epoch: 1, sessionId: 'session_01' },
    input: { requestId: request.requestId, response },
    type: 'interaction.respond',
  });
};

const effect = <Type extends SessionEffect['type']>(
  effects: readonly SessionEffect[],
  type: Type,
): Extract<SessionEffect, { readonly type: Type }> | undefined =>
  effects.find(
    (candidate): candidate is Extract<SessionEffect, { readonly type: Type }> =>
      candidate.type === type,
  );

test.each([
  { kind: 'permission', optionId: 'allow', outcome: 'selected' },
  { kind: 'permission', outcome: 'denied' },
] as const)('accepts a valid permission response: $outcome', (response) => {
  const transition = respond(permissionInteractionRequest, response);
  expect(effect(transition.effects, 'provider.interaction.respond')).toBeDefined();
});

test.each([
  { kind: 'input', outcome: 'declined' },
  { kind: 'input', outcome: 'cancelled' },
  {
    kind: 'input',
    outcome: 'submitted',
    values: { confirm: true, multiple: ['first', 'second'], name: 'Revo', single: 'custom' },
  },
] as const)('accepts a valid input response: $outcome', (response) => {
  const transition = respond(inputInteractionRequest, response);
  expect(effect(transition.effects, 'provider.interaction.respond')).toBeDefined();
});

test.each([
  ['wrong response kind', { kind: 'permission', outcome: 'denied' }],
  [
    'missing required answer',
    {
      kind: 'input',
      outcome: 'submitted',
      values: { confirm: true, multiple: ['first'], single: 'known' },
    },
  ],
  [
    'unknown question',
    {
      kind: 'input',
      outcome: 'submitted',
      values: { confirm: true, extra: 'x', multiple: ['first'], name: 'Revo', single: 'known' },
    },
  ],
  [
    'short text',
    {
      kind: 'input',
      outcome: 'submitted',
      values: { confirm: true, multiple: ['first'], name: 'R', single: 'known' },
    },
  ],
  [
    'fractional integer',
    {
      kind: 'input',
      outcome: 'submitted',
      values: { confirm: true, count: 1.5, multiple: ['first'], name: 'Revo', single: 'known' },
    },
  ],
  [
    'out-of-range number',
    {
      kind: 'input',
      outcome: 'submitted',
      values: { confirm: true, count: 4, multiple: ['first'], name: 'Revo', single: 'known' },
    },
  ],
  [
    'wrong boolean',
    {
      kind: 'input',
      outcome: 'submitted',
      values: { confirm: 'yes', multiple: ['first'], name: 'Revo', single: 'known' },
    },
  ],
  [
    'array for single select',
    {
      kind: 'input',
      outcome: 'submitted',
      values: { confirm: true, multiple: ['first'], name: 'Revo', single: ['known'] },
    },
  ],
  [
    'scalar for multiple select',
    {
      kind: 'input',
      outcome: 'submitted',
      values: { confirm: true, multiple: 'first', name: 'Revo', single: 'known' },
    },
  ],
  [
    'unknown multiple option',
    {
      kind: 'input',
      outcome: 'submitted',
      values: { confirm: true, multiple: ['other'], name: 'Revo', single: 'known' },
    },
  ],
] as const)('rejects %s', (_name, response) => {
  const transition = respond(inputInteractionRequest, response);
  expect(effect(transition.effects, 'public.reject')?.fault.code).toBe(
    'revo.agent.interaction_invalid',
  );
  expect(effect(transition.effects, 'provider.interaction.respond')).toBeUndefined();
});

test('rejects an unknown permission option', () => {
  const transition = respond(permissionInteractionRequest, {
    kind: 'permission',
    optionId: 'missing',
    outcome: 'selected',
  });
  expect(effect(transition.effects, 'public.reject')?.fault.code).toBe(
    'revo.agent.interaction_invalid',
  );
});
