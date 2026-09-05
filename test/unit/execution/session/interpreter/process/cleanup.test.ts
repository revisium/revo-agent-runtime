import { expect, it } from 'vitest';

import type {
  OwnedProcess,
  ProcessCleanupOutcome,
} from '../../../../../../src/execution/process/port.js';
import { createProcessCleanupInterpreter } from '../../../../../../src/execution/session/interpreter/process/cleanup.js';
import { createSessionInterpreterResources } from '../../../../../../src/execution/session/interpreter/provider/opening/resources.js';
import { recordingSessionEffectOutput } from '../../../../../support/session/interpreter/output.js';
import { flushMicrotasks } from '../../../../../support/session/runtime/scheduling/async-steps.js';

const clock = { now: () => ({ iso: '2026-09-05T00:00:05.000Z', milliseconds: 5_000 }) };
const identity = {
  fingerprint: 'sha256:process',
  pid: 42,
  processGroupId: 42,
  startedAt: '2026-09-05T00:00:00.000Z',
};
const effect = {
  correlation: { effectId: 'cleanup', epoch: 1, sessionId: 'session_01' },
  process: identity,
  processResourceId: 'process-1',
  timeoutMs: 100,
  type: 'process.cleanup' as const,
};

const process = (outcome: ProcessCleanupOutcome): OwnedProcess => ({
  completion: Promise.resolve({ exitCode: 0, signal: null }),
  identity,
  terminateAndReap: async () => outcome,
  transport: {
    input: new WritableStream<Uint8Array>(),
    output: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
  },
});

it('publishes confirmed cleanup only after terminate-and-reap confirms it', async () => {
  const resources = createSessionInterpreterResources();
  resources.processes.register(
    'process-1',
    process({ exit: { exitCode: 0, signal: null }, status: 'confirmed' }),
  );
  const recorded = recordingSessionEffectOutput();
  createProcessCleanupInterpreter({ clock, resources }).execute(effect, recorded.output);
  await flushMicrotasks(8);
  expect(recorded.outcomes.at(-1)?.type).toBe('process.cleanup.confirmed');
  expect(resources.processes.get('process-1')).toBeUndefined();
});

it('ignores an effect outside the cleanup discriminant', async () => {
  const recorded = recordingSessionEffectOutput();
  createProcessCleanupInterpreter({
    clock,
    resources: createSessionInterpreterResources(),
  }).execute({ type: 'other' } as never, recorded.output);
  await flushMicrotasks(2);
  expect(recorded.outcomes).toEqual([]);
});

it.each([{ status: 'uncertain' } as const, undefined])(
  'retains cleanup uncertainty for unconfirmed or missing ownership: %o',
  async (outcome) => {
    const resources = createSessionInterpreterResources();
    if (outcome !== undefined) resources.processes.register('process-1', process(outcome));
    const recorded = recordingSessionEffectOutput();
    createProcessCleanupInterpreter({ clock, resources }).execute(effect, recorded.output);
    await flushMicrotasks(8);
    expect(recorded.outcomes.at(-1)).toMatchObject({
      fault: { code: 'revo.agent.process_cleanup_failed' },
      type: 'process.cleanup.uncertain',
    });
  },
);

it('restores a process when the expected ownership identity does not match', async () => {
  const resources = createSessionInterpreterResources();
  const owned = process({ exit: { exitCode: 0, signal: null }, status: 'confirmed' });
  resources.processes.register('process-1', owned);
  const recorded = recordingSessionEffectOutput();
  createProcessCleanupInterpreter({ clock, resources }).execute(
    { ...effect, process: { ...identity, fingerprint: 'other' } },
    recorded.output,
  );
  await flushMicrotasks(8);

  expect(recorded.outcomes.at(-1)?.type).toBe('process.cleanup.uncertain');
  expect(resources.processes.get('process-1')).toBe(owned);
});

it('contains a thrown terminate-and-reap operation', async () => {
  const resources = createSessionInterpreterResources();
  resources.processes.register('process-1', {
    ...process({ status: 'uncertain' }),
    terminateAndReap: async () => {
      throw new Error('cleanup failed');
    },
  });
  const recorded = recordingSessionEffectOutput();
  createProcessCleanupInterpreter({ clock, resources }).execute(effect, recorded.output);
  await flushMicrotasks(8);
  expect(recorded.outcomes.at(-1)?.type).toBe('process.cleanup.uncertain');
});

it('reports uncertain cleanup after both timeout observation windows expire', async () => {
  const resources = createSessionInterpreterResources();
  resources.processes.register('process-1', {
    ...process({ status: 'uncertain' }),
    terminateAndReap: async () => new Promise<never>(() => undefined),
  });
  const timer = {
    schedule: (_milliseconds: number, callback: () => void) => {
      queueMicrotask(callback);
      return { cancel: () => undefined };
    },
  };
  const recorded = recordingSessionEffectOutput();
  createProcessCleanupInterpreter({ clock, resources, timer }).execute(effect, recorded.output);
  await flushMicrotasks(12);
  expect(recorded.outcomes.at(-1)?.type).toBe('process.cleanup.uncertain');
});
