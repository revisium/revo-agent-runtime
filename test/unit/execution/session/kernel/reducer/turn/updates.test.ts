import { expect, test } from 'vitest';

import type { SessionCommand } from '../../../../../../../src/execution/session/kernel/command/session-command.js';
import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import type { TurnEffectCorrelation } from '../../../../../../../src/execution/session/kernel/model/identity.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { reduceProviderUpdate } from '../../../../../../../src/execution/session/kernel/reducer/turn/updates.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:02.000Z', observedAtMs: 2_000 } as const;
const effectOf = <Type extends SessionEffect['type']>(
  transition: SessionTransition,
  type: Type,
): Extract<SessionEffect, { readonly type: Type }> => {
  const effect = transition.effects.find(
    (candidate): candidate is Extract<SessionEffect, { readonly type: Type }> =>
      candidate.type === type,
  );
  if (effect === undefined) throw new Error(`Missing ${type} effect.`);
  return effect;
};

const streamingTurn = () => {
  const sent = reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'send_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    input: { prompt: 'Continue', turnId: 'turn_01' },
    resultCallId: 'result_01',
    type: 'turn.send',
  });
  const append = effectOf(sent, 'event.append');
  const prompting = reduceSession(sent.state, {
    ...observed,
    correlation: append.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  const prompt = effectOf(prompting, 'provider.prompt');
  const streaming = reduceSession(prompting.state, {
    ...observed,
    correlation: prompt.correlation,
    type: 'provider.prompt.accepted',
  });
  return { correlation: prompt.correlation, state: streaming.state };
};

test('normalizes every provider update into its public event', () => {
  const cases: readonly [string, (correlation: TurnEffectCorrelation) => SessionCommand][] = [
    [
      'assistant.message.delta',
      (correlation) => ({ ...observed, content: 'A', correlation, type: 'provider.message_delta' }),
    ],
    [
      'assistant.message.completed',
      (correlation) => ({
        ...observed,
        contentBytes: 1,
        contentSha256: 'sha',
        correlation,
        type: 'provider.message_completed',
      }),
    ],
    [
      'agent.progress',
      (correlation) => ({
        ...observed,
        correlation,
        message: 'Working',
        type: 'provider.progress',
      }),
    ],
    [
      'tool.activity',
      (correlation) => ({
        ...observed,
        correlation,
        kind: 'read',
        status: 'started',
        title: 'Read',
        toolCallId: 'tool_01',
        type: 'provider.tool',
      }),
    ],
    [
      'plan.updated',
      (correlation) => ({
        ...observed,
        correlation,
        items: [{ itemId: 'one', status: 'pending', title: 'One' }],
        type: 'provider.plan',
      }),
    ],
    [
      'usage.updated',
      (correlation) => ({
        ...observed,
        correlation,
        type: 'provider.usage',
        usage: { inputTokens: 2, scope: 'session_cumulative', totalTokens: 2 },
      }),
    ],
  ] as const;

  for (const [eventType, command] of cases) {
    const { correlation, state } = streamingTurn();
    const transition = reduceSession(state, command(correlation));
    expect(effectOf(transition, 'event.append').event.type).toBe(eventType);
  }
});

test('routes interaction requests outside generic update normalization', () => {
  const { correlation, state } = streamingTurn();
  const transition = reduceSession(state, {
    ...observed,
    correlation,
    providerResourceId: 'provider_01',
    request: { kind: 'input', message: 'Choose', questions: [], requestId: 'request_01' },
    scope: { kind: 'turn', turnId: 'turn_01' },
    type: 'provider.interaction_requested',
  });
  expect(transition.state).toMatchObject({
    interactions: [{ request: { requestId: 'request_01' }, stage: 'publishing' }],
    turn: { status: 'awaiting_interaction' },
  });
  expect(effectOf(transition, 'event.append').event.type).toBe('interaction.requested');
});

test('generic update normalization declines interaction requests', () => {
  const { correlation, state } = streamingTurn();
  const command = {
    ...observed,
    correlation,
    providerResourceId: 'provider_01',
    request: { kind: 'input', message: 'Choose', questions: [], requestId: 'request_01' },
    scope: { kind: 'turn', turnId: 'turn_01' },
    type: 'provider.interaction_requested',
  } as const;
  expect(
    reduceProviderUpdate(state as Parameters<typeof reduceProviderUpdate>[0], command),
  ).toEqual({ effects: [], state });
});
