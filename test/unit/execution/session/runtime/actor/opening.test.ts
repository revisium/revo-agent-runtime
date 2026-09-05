import { describe, expect, test } from 'vitest';

import { createOpeningSessionState } from '../../../../../../src/execution/session/kernel/reducer/opening/state.js';
import { reduceSession } from '../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { SessionActor } from '../../../../../../src/execution/session/runtime/actor/session-actor.js';
import {
  SessionEffectDispatcher,
  type SessionEffectInterpreter,
} from '../../../../../../src/execution/session/runtime/effects/dispatcher.js';
import type { SessionEffectOutput } from '../../../../../../src/execution/session/runtime/effects/outcomes.js';
import type { SessionClock } from '../../../../../../src/execution/session/runtime/timing/clock.js';
import {
  sessionCapabilities,
  sessionOpeningCommand,
  sessionProcess,
} from '../../../../../support/session/builders/kernel/opening.js';

const observed = { observedAt: '2026-09-05T00:00:00.000Z', observedAtMs: 1_000 } as const;
const clock: SessionClock = {
  now: () => ({ iso: observed.observedAt, milliseconds: observed.observedAtMs }),
  schedule: () => ({ cancel: () => undefined }),
};

describe('real opening kernel through the runtime actor', () => {
  test('opens in durable order and cleans a late foreign provider resource', async () => {
    const command = sessionOpeningCommand();
    const effectOrder: string[] = [];
    const closedResources: string[] = [];
    let providerOutput: SessionEffectOutput | undefined;
    let providerCorrelation:
      | { readonly effectId: string; readonly epoch: number; readonly sessionId: string }
      | undefined;
    const interpreters: SessionEffectInterpreter[] = [
      {
        execute: (effect, output) => {
          effectOrder.push(effect.type);
          output.outcome({
            ...observed,
            correlation: effect.correlation,
            result: { state: 'appended' },
            type: 'event.applied',
          });
        },
        type: 'event.append',
      },
      {
        execute: (effect, output) => {
          effectOrder.push(effect.type);
          output.outcome({
            ...observed,
            correlation: effect.correlation,
            preparationId: 'preparation_01',
            type: 'opening.preparation.succeeded',
          });
        },
        type: 'opening.prepare',
      },
      {
        execute: (effect, output) => {
          effectOrder.push(effect.type);
          output.outcome({
            ...observed,
            correlation: effect.correlation,
            process: sessionProcess,
            processResourceId: 'process_01',
            type: 'process.started',
          });
        },
        type: 'process.start',
      },
      {
        execute: (effect, output) => {
          effectOrder.push(effect.type);
          output.outcome({
            ...observed,
            correlation: effect.correlation,
            result: { state: 'applied' },
            type: 'persistence.applied',
          });
        },
        type: 'persistence.save',
      },
      {
        execute: (effect, output) => {
          effectOrder.push(effect.type);
          providerOutput = output;
          providerCorrelation = effect.correlation;
          output.outcome({
            ...observed,
            capabilities: sessionCapabilities,
            correlation: effect.correlation,
            providerResourceId: 'provider_01',
            type: 'provider.opened',
          });
        },
        type: 'provider.open',
      },
      {
        execute: (effect) => {
          if (effect.type !== 'provider.close') throw new Error('Expected provider close.');
          closedResources.push(effect.providerResourceId);
        },
        type: 'provider.close',
      },
    ];
    const actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher(interpreters),
      initialState: createOpeningSessionState(command),
      reducer: reduceSession,
    });
    const ready = actor.registerCall(command.call.callId);

    actor.dispatch(command);
    await expect(ready).resolves.toMatchObject({
      resolution: { kind: 'session_ready' },
      state: 'resolved',
    });
    expect(actor.state).toMatchObject({ providerResourceId: 'provider_01', status: 'idle' });
    expect(effectOrder).toEqual([
      'event.append',
      'opening.prepare',
      'process.start',
      'persistence.save',
      'provider.open',
      'event.append',
    ]);

    if (providerOutput === undefined || providerCorrelation === undefined)
      throw new Error('Provider opening did not run.');
    providerOutput.outcome({
      ...observed,
      capabilities: sessionCapabilities,
      correlation: providerCorrelation,
      providerResourceId: 'late_provider',
      type: 'provider.opened',
    });
    await actor.whenQuiescent();

    expect(actor.state).toMatchObject({ providerResourceId: 'provider_01', status: 'idle' });
    expect(closedResources).toEqual(['late_provider']);
  });
});
