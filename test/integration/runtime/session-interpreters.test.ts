import { createHash } from 'node:crypto';

import { expect, test } from 'vitest';

import { validateAgentDefinition } from '../../../src/definition/index.js';
import { composeSessionInterpreters } from '../../../src/execution/session/interpreter/composition/interpreters.js';
import { createOpeningSessionState } from '../../../src/execution/session/kernel/reducer/opening/state.js';
import { reduceSession } from '../../../src/execution/session/kernel/reducer/reduce.js';
import { SessionActor } from '../../../src/execution/session/runtime/actor/session-actor.js';
import { SessionEffectDispatcher } from '../../../src/execution/session/runtime/effects/dispatcher.js';
import type { SessionClock } from '../../../src/execution/session/runtime/timing/clock.js';
import { agentDefinition } from '../../support/builders/agent-definition.js';
import { sessionOpeningCommand } from '../../support/session/builders/kernel/opening.js';
import { createControllableSessionProtocolDriver } from '../../support/session/fakes/protocol/driver.js';

const capabilities = {
  cancellation: { prompt: true, session: true },
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;
const clock: SessionClock = {
  now: () => ({ iso: '2026-09-05T00:00:10.000Z', milliseconds: 10_000 }),
  schedule: () => ({ cancel: () => undefined }),
};

test('complete real kernel and interpreter composition opens, turns, checkpoints, and closes', async () => {
  const events: string[] = [];
  const stateMutations: string[] = [];
  const driver = createControllableSessionProtocolDriver({
    checkpoints: [
      {
        continuation: { data: { providerSessionId: 'native-1' }, format: 'acp/v1' },
        status: 'captured',
      },
    ],
    closes: [{ status: 'closed' }],
    openings: [{ kind: 'fresh', outcome: { capabilities, status: 'opened' }, steps: [] }],
    prompts: [
      {
        outcome: {
          status: 'completed',
          usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        },
        steps: [{ type: 'update', value: { content: 'Done', type: 'message.delta' } }],
      },
    ],
  });
  const definition = validateAgentDefinition(agentDefinition({ version: '1' })).definition;
  const process = {
    completion: new Promise<never>(() => undefined),
    identity: {
      fingerprint: 'process-fingerprint',
      pid: 42,
      processGroupId: 42,
      startedAt: '2026-09-05T00:00:01.000Z',
    },
    terminateAndReap: async () => ({
      exit: { exitCode: 0, signal: null },
      status: 'confirmed' as const,
    }),
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    },
  };
  const identityValues = ['preparation-1', 'process-1', 'provider-1'];
  const composition = composeSessionInterpreters({
    activeStateSink: {
      remove: async () => {
        stateMutations.push('remove');
        return { state: 'applied' };
      },
      save: async (snapshot) => {
        stateMutations.push(`save:${snapshot.state}`);
        return { state: 'applied' };
      },
    },
    clock,
    digest: {
      digest: (bytes) => createHash('sha256').update(bytes).digest('hex'),
    },
    driver,
    eventSink: {
      append: async (event) => {
        events.push(event.type);
        return { state: 'appended' };
      },
    },
    identities: {
      next: () => {
        const value = identityValues.shift();
        if (value === undefined) throw new Error('Missing identity.');
        return value;
      },
    },
    preparer: {
      prepare: async () => ({
        status: 'prepared',
        value: {
          definition,
          launch: { args: [], command: 'agent', cwd: '/workspace' },
          output: {
            publish: async (publication) => {
              expect(publication.status).toBe('closed');
              return {
                files: {
                  directory: '/output',
                  manifest: 'session.json',
                  stderr: 'stderr.log',
                  stdout: 'stdout.log',
                },
                state: 'published',
              };
            },
          },
        },
      }),
    },
    spawner: { start: async () => process },
    timer: clock,
  });
  const opening = sessionOpeningCommand();
  const actor = new SessionActor({
    clock,
    dispatcher: new SessionEffectDispatcher(composition.interpreters),
    initialState: createOpeningSessionState(opening),
    reducer: reduceSession,
  });

  const ready = actor.registerCall(opening.call.callId);
  actor.dispatch(opening);
  await expect(ready).resolves.toMatchObject({ resolution: { kind: 'session_ready' } });
  expect(actor.state.status).toBe('idle');

  const turnReady = actor.registerCall('send-1');
  const turnResult = actor.registerCall('result-1');
  actor.dispatch({
    call: { callId: 'send-1', epoch: 1, sessionId: 'session_01', turnId: 'turn-1' },
    input: { prompt: 'Do the work', turnId: 'turn-1' },
    observedAt: clock.now().iso,
    observedAtMs: clock.now().milliseconds,
    resultCallId: 'result-1',
    type: 'turn.send',
  });
  await expect(turnReady).resolves.toMatchObject({ resolution: { kind: 'turn_ready' } });
  await expect(turnResult).resolves.toMatchObject({
    resolution: {
      kind: 'turn_result',
      result: { message: { content: 'Done' }, status: 'completed' },
    },
  });

  const checkpoint = actor.registerCall('checkpoint-call');
  actor.dispatch({
    call: { callId: 'checkpoint-call', epoch: 1, sessionId: 'session_01' },
    checkpointId: 'checkpoint-1',
    observedAt: clock.now().iso,
    observedAtMs: clock.now().milliseconds,
    type: 'session.checkpoint',
  });
  await expect(checkpoint).resolves.toMatchObject({
    resolution: { checkpoint: { eligibility: 'observation_only' }, kind: 'checkpoint' },
  });

  const close = actor.registerCall('close-call');
  actor.dispatch({
    call: { callId: 'close-call', epoch: 1, sessionId: 'session_01' },
    observedAt: clock.now().iso,
    observedAtMs: clock.now().milliseconds,
    type: 'session.close',
  });
  await expect(close).resolves.toMatchObject({
    resolution: { kind: 'close', result: { state: 'closed' } },
  });
  await actor.whenQuiescent();

  expect(actor.state.status).toBe('closed');
  expect(stateMutations).toEqual(['save:opening', 'remove']);
  expect(events).toEqual([
    'session.accepted',
    'session.opened',
    'turn.started',
    'assistant.message.delta',
    'assistant.message.completed',
    'usage.updated',
    'turn.completed',
    'session.checkpointed',
    'session.closed',
  ]);
  expect(driver.calls.map(({ type }) => type)).toEqual([
    'open.fresh',
    'prompt',
    'checkpoint',
    'session.close',
  ]);
});
