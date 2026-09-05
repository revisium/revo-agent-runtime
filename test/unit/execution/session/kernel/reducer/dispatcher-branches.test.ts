import { expect, test } from 'vitest';

import { reduceCheckpointSession } from '../../../../../../src/execution/session/kernel/reducer/checkpoint.js';
import { reduceHibernation } from '../../../../../../src/execution/session/kernel/reducer/checkpoint/hibernate.js';
import { reduceInteractionSession } from '../../../../../../src/execution/session/kernel/reducer/interaction.js';
import { reduceSession } from '../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { reduceTerminalizing } from '../../../../../../src/execution/session/kernel/reducer/terminal.js';
import { reduceActiveTerminal } from '../../../../../../src/execution/session/kernel/reducer/terminal.js';
import { queueSessionEvent } from '../../../../../../src/execution/session/kernel/reducer/transition.js';
import { reduceTurnSession } from '../../../../../../src/execution/session/kernel/reducer/turn.js';
import { streamingSessionState } from '../../../../../support/session/builders/kernel/running.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:03.000Z', observedAtMs: 3_000 } as const;
const irrelevant = {
  ...observed,
  call: { callId: 'respond', epoch: 1, sessionId: 'session_01' },
  input: {
    requestId: 'request',
    response: { kind: 'permission', outcome: 'denied' },
  },
  type: 'interaction.respond',
} as const;

test('state-specific dispatchers decline commands owned by another capability', () => {
  const idle = idleSessionState();
  expect(reduceActiveTerminal(idle, irrelevant)).toEqual({ effects: [], state: idle });
  expect(
    reduceInteractionSession(idle, {
      ...observed,
      correlation: { effectId: 'provider', epoch: 1, sessionId: idle.sessionId, turnId: 'turn' },
      providerResourceId: idle.providerResourceId,
      request: { kind: 'input', message: 'Input', questions: [], requestId: 'request' },
      scope: { kind: 'turn', turnId: 'turn' },
      type: 'provider.interaction_requested',
    }),
  ).toBeUndefined();

  let transition = reduceSession(idle, {
    ...observed,
    call: { callId: 'checkpoint', epoch: 1, sessionId: idle.sessionId },
    checkpointId: 'checkpoint',
    type: 'session.checkpoint',
  });
  expect(reduceCheckpointSession(transition.state, irrelevant)).toBeUndefined();

  transition = reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'hibernate', epoch: 1, sessionId: idle.sessionId },
    resumeTokenId: 'resume-token',
    type: 'session.hibernate',
  });
  expect(reduceHibernation(transition.state, irrelevant)).toBeUndefined();

  transition = reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'close', epoch: 1, sessionId: idle.sessionId },
    type: 'session.close',
  });
  const terminal = reduceTerminalizing(
    transition.state as Parameters<typeof reduceTerminalizing>[0],
    irrelevant,
  );
  expect(terminal).toEqual({ effects: [], state: transition.state });

  const running = streamingSessionState();
  expect(reduceTurnSession(running, irrelevant)).toEqual({ effects: [], state: running });
});

test('defaults a first durable event to an empty-stream precondition', () => {
  const source = idleSessionState();
  const state = { ...source, events: { pending: [] as const } };
  const transition = queueSessionEvent(state, {
    eventId: 'first',
    observedAt: observed.observedAt,
    pin: state.pin,
    resumed: false,
    schemaVersion: 'agent-session-event/v1',
    sequence: state.nextEventSequence,
    sessionId: state.sessionId,
    streamId: state.streamId,
    type: 'session.accepted',
  });
  expect(transition.effects[0]).toMatchObject({ expected: { kind: 'empty' } });
});
