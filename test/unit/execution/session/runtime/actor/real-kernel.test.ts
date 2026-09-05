import { describe, expect, test } from 'vitest';

import { reduceSession } from '../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { SessionActor } from '../../../../../../src/execution/session/runtime/actor/session-actor.js';
import {
  SessionEffectDispatcher,
  type SessionEffectInterpreter,
} from '../../../../../../src/execution/session/runtime/effects/dispatcher.js';
import type { SessionEffectOutput } from '../../../../../../src/execution/session/runtime/effects/outcomes.js';
import type { SessionClock } from '../../../../../../src/execution/session/runtime/timing/clock.js';
import { permissionInteractionRequest } from '../../../../../support/session/builders/kernel/interactions.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-09-05T00:00:00.000Z', observedAtMs: 2_000 } as const;
const clock: SessionClock = {
  now: () => ({ iso: observed.observedAt, milliseconds: observed.observedAtMs }),
  schedule: () => ({ cancel: () => undefined }),
};

describe('complete kernel through the runtime actor', () => {
  test('runs an interactive turn, filters stale work, and publishes a checkpoint', async () => {
    let providerOutput: SessionEffectOutput | undefined;
    const eventTypes: string[] = [];
    const events = {
      execute: (effect, output) => {
        if (effect.type !== 'event.append') throw new Error('Expected event append.');
        eventTypes.push(effect.event.type);
        output.outcome({
          ...observed,
          correlation: effect.correlation,
          result: { state: 'appended' },
          type: 'event.applied',
        });
      },
      type: 'event.append',
    } satisfies SessionEffectInterpreter;
    const prompt = {
      execute: (effect, output) => {
        if (effect.type !== 'provider.prompt') throw new Error('Expected provider prompt.');
        providerOutput = output;
        output.outcome({
          ...observed,
          correlation: effect.correlation,
          type: 'provider.prompt.accepted',
        });
        output.offerUpdate({
          ...observed,
          correlation: effect.correlation,
          providerResourceId: 'provider_01',
          request: permissionInteractionRequest,
          scope: { kind: 'turn', turnId: 'turn_01' },
          type: 'provider.interaction_requested',
        });
      },
      type: 'provider.prompt',
    } satisfies SessionEffectInterpreter;
    const interaction = {
      execute: (effect, output) =>
        output.outcome({
          ...observed,
          correlation: effect.correlation,
          type: 'provider.interaction.accepted',
        }),
      type: 'provider.interaction.respond',
    } satisfies SessionEffectInterpreter;
    const checkpoint = {
      execute: (effect, output) => {
        if (effect.type !== 'checkpoint.capture') throw new Error('Expected checkpoint capture.');
        if (effect.kind !== 'checkpoint') throw new Error('Expected an observation checkpoint.');
        output.outcome({
          ...observed,
          checkpoint: {
            checkpointId: effect.checkpointId,
            cursor: effect.cursor,
            eligibility: 'observation_only',
            payload: 'opaque-provider-state',
            pin: effect.pin,
            schemaVersion: 'agent-session-checkpoint/v1',
            sessionId: 'session_01',
            sha256: 'checkpoint-sha256',
          },
          correlation: effect.correlation,
          kind: 'checkpoint',
          type: 'checkpoint.captured',
        });
      },
      type: 'checkpoint.capture',
    } satisfies SessionEffectInterpreter;
    const actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([events, prompt, interaction, checkpoint]),
      initialState: idleSessionState(),
      reducer: reduceSession,
    });

    const turnReady = actor.registerCall('send_01');
    const turnResult = actor.registerCall('result_01');
    actor.dispatch({
      ...observed,
      call: { callId: 'send_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
      input: { prompt: 'Continue', turnId: 'turn_01' },
      resultCallId: 'result_01',
      type: 'turn.send',
    });

    await expect(turnReady).resolves.toMatchObject({
      resolution: { kind: 'turn_ready', turnId: 'turn_01' },
      state: 'resolved',
    });
    expect(actor.state).toMatchObject({
      interactions: [{ request: { requestId: 'request_01' }, stage: 'ready' }],
      status: 'running',
      turn: { status: 'awaiting_interaction' },
    });

    const response = actor.registerCall('respond_01');
    actor.dispatch({
      ...observed,
      call: { callId: 'respond_01', epoch: 1, sessionId: 'session_01' },
      input: {
        requestId: 'request_01',
        response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
      },
      type: 'interaction.respond',
    });
    await expect(response).resolves.toMatchObject({
      resolution: { kind: 'interaction', result: { state: 'accepted' } },
      state: 'resolved',
    });

    if (providerOutput === undefined) throw new Error('Prompt interpreter did not start.');
    await expect(
      providerOutput.update({
        ...observed,
        content: 'Done',
        correlation: {
          effectId: 'stale',
          epoch: 2,
          sessionId: 'session_01',
          turnId: 'turn_01',
        },
        type: 'provider.message_delta',
      }),
    ).resolves.toBe('stale');
    await expect(
      providerOutput.update({
        ...observed,
        content: 'wrong turn',
        correlation: {
          effectId: 'stale',
          epoch: 1,
          sessionId: 'session_01',
          turnId: 'turn_02',
        },
        type: 'provider.message_delta',
      }),
    ).resolves.toBe('stale');
    const promptCorrelation =
      actor.state.status === 'running' && 'correlation' in actor.state.turn
        ? actor.state.turn.correlation
        : undefined;
    if (promptCorrelation === undefined) throw new Error('Prompt correlation is missing.');
    await expect(
      providerOutput.update({
        ...observed,
        content: 'Done',
        correlation: promptCorrelation,
        type: 'provider.message_delta',
      }),
    ).resolves.toBe('processed');
    providerOutput.outcome({
      ...observed,
      correlation: promptCorrelation,
      outcome: {
        status: 'completed',
        usage: { inputTokens: 2, outputTokens: 1, scope: 'session_cumulative', totalTokens: 3 },
      },
      type: 'provider.prompt.completed',
    });

    await expect(turnResult).resolves.toMatchObject({
      resolution: {
        kind: 'turn_result',
        result: { message: { content: 'Done' }, status: 'completed' },
      },
      state: 'resolved',
    });
    expect(actor.state.status).toBe('idle');

    providerOutput.outcome({
      ...observed,
      correlation: promptCorrelation,
      fault: {
        code: 'revo.agent.protocol_failed',
        message: 'Late provider failure.',
        phase: 'session_running',
        retryable: false,
      },
      type: 'provider.prompt.failed',
    });
    expect(actor.state.status).toBe('idle');

    const checkpointResult = actor.registerCall('checkpoint_01');
    actor.dispatch({
      ...observed,
      call: { callId: 'checkpoint_01', epoch: 1, sessionId: 'session_01' },
      checkpointId: 'checkpoint_01',
      type: 'session.checkpoint',
    });
    await expect(checkpointResult).resolves.toMatchObject({
      resolution: {
        checkpoint: { checkpointId: 'checkpoint_01', eligibility: 'observation_only' },
        kind: 'checkpoint',
      },
      state: 'resolved',
    });
    await actor.whenQuiescent();

    expect(eventTypes).toEqual([
      'turn.started',
      'interaction.requested',
      'interaction.resolved',
      'assistant.message.delta',
      'turn.completed',
      'session.checkpointed',
    ]);
    expect(actor.state.status).toBe('idle');
    expect(actor.activeEffects).toBe(0);
  });
});
