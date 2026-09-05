import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { createOpeningSessionState } from '../../../../../../../src/execution/session/kernel/reducer/opening.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import {
  outcomeTime,
  outcomeTimeMs,
  sessionCapabilities,
  sessionOpeningCommand,
  sessionProcess,
} from '../../../../../../support/session/builders/kernel/opening.js';

const observed = { observedAt: outcomeTime, observedAtMs: outcomeTimeMs } as const;
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

const providerOpening = (mode: 'fresh' | 'resume') => {
  const command = sessionOpeningCommand(mode);
  let transition = reduceSession(createOpeningSessionState(command), command);
  const accepted = effectOf(transition, 'event.append');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: accepted.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  const preparation = effectOf(transition, 'opening.prepare');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: preparation.correlation,
    preparationId: 'preparation_01',
    type: 'opening.preparation.succeeded',
  });
  const start = effectOf(transition, 'process.start');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: start.correlation,
    process: sessionProcess,
    processResourceId: 'process_01',
    type: 'process.started',
  });
  const save = effectOf(transition, 'persistence.save');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: save.correlation,
    result: { state: 'applied' },
    type: 'persistence.applied',
  });
  return { open: effectOf(transition, 'provider.open'), state: transition.state };
};

test.each(['fresh', 'resume'] as const)(
  'routes an interaction reentrantly during %s opening',
  (mode) => {
    const opening = providerOpening(mode);
    const permission = {
      action: { kind: 'execute' },
      kind: 'permission',
      options: [{ kind: 'allow_once', label: 'Allow', optionId: 'allow' }],
      requestId: 'permission_01',
    } as const;
    let transition = reduceSession(opening.state, {
      ...observed,
      correlation: opening.open.correlation,
      providerResourceId: 'provider_01',
      request: permission,
      scope: { kind: 'opening' },
      type: 'provider.interaction_requested',
    });
    const requested = effectOf(transition, 'event.append');

    transition = reduceSession(transition.state, {
      ...observed,
      call: { callId: 'respond_01', epoch: 1, sessionId: 'session_01' },
      input: {
        requestId: 'permission_01',
        response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
      },
      type: 'interaction.respond',
    });
    expect(transition.effects.map(({ type }) => type)).toEqual(['public.resolve']);

    transition = reduceSession(transition.state, {
      ...observed,
      correlation: requested.correlation,
      result: { state: 'appended' },
      type: 'event.applied',
    });
    const response = effectOf(transition, 'provider.interaction.respond');
    expect(response.providerResourceId).toBe('provider_01');

    transition = reduceSession(transition.state, {
      ...observed,
      correlation: response.correlation,
      type: 'provider.interaction.accepted',
    });
    const resolved = effectOf(transition, 'event.append');
    transition = reduceSession(transition.state, {
      ...observed,
      correlation: resolved.correlation,
      result: { state: 'appended' },
      type: 'event.applied',
    });
    expect(transition.state).toMatchObject({ interactions: [], status: 'opening' });

    transition = reduceSession(transition.state, {
      ...observed,
      capabilities: sessionCapabilities,
      correlation: opening.open.correlation,
      providerResourceId: 'provider_01',
      type: 'provider.opened',
    });
    expect(effectOf(transition, 'event.append').event.type).toBe('session.opened');
  },
);

test('ignores an opening interaction request before provider ownership', () => {
  const command = sessionOpeningCommand();
  const state = createOpeningSessionState(command);
  const transition = reduceSession(state, {
    ...observed,
    correlation: { effectId: 'foreign', epoch: 1, sessionId: state.sessionId },
    providerResourceId: 'provider_01',
    request: {
      action: { kind: 'execute' },
      kind: 'permission',
      options: [],
      requestId: 'permission_01',
    },
    scope: { kind: 'opening' },
    type: 'provider.interaction_requested',
  });
  expect(transition).toEqual({ effects: [], state });
});
