import { afterEach, beforeEach, expect, it, test, vi } from 'vitest';

import type { OwnedProcess } from '../../../../../../src/execution/process/port.js';
import { createProcessStartInterpreter } from '../../../../../../src/execution/session/interpreter/provider/opening/process.js';
import { createSessionInterpreterResources } from '../../../../../../src/execution/session/interpreter/provider/opening/resources.js';
import type { SessionProtocolSession } from '../../../../../../src/protocol/session/port/session.js';
import { recordingSessionEffectOutput } from '../../../../../support/session/interpreter/output.js';
import { registerProtocolSession } from '../../../../../support/session/interpreter/provider.js';
import { flushMicrotasks } from '../../../../../support/session/runtime/scheduling/async-steps.js';

const clock = { now: () => ({ iso: '2026-09-05T00:00:01.000Z', milliseconds: 1_000 }) };
const session: SessionProtocolSession = {
  checkpoint: async () => ({
    failure: { code: 'capability_unsupported', message: 'no', retryable: false },
    status: 'unsupported',
  }),
  close: async () => ({ status: 'closed' }),
  prompt: () => {
    throw new Error('unused');
  },
  respond: async () => ({ status: 'accepted' }),
};
const effect = {
  correlation: { effectId: 'start', epoch: 1, sessionId: 'session_01' },
  preparationId: 'preparation-1',
  timeoutMs: 10,
  type: 'process.start' as const,
};

const ownedProcess = () => {
  const terminateAndReap = vi.fn<OwnedProcess['terminateAndReap']>(async () => ({
    exit: { exitCode: 0, signal: null },
    status: 'confirmed',
  }));
  const process: OwnedProcess = {
    completion: new Promise<never>(() => undefined),
    identity: {
      fingerprint: 'process',
      pid: 42,
      processGroupId: 42,
      startedAt: clock.now().iso,
    },
    terminateAndReap,
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    },
  };
  return { process, terminateAndReap };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('registers a start that settles in the late reconciliation window', async () => {
  const pending = Promise.withResolvers<OwnedProcess>();
  const resources = createSessionInterpreterResources();
  registerProtocolSession(resources, session);
  const recorded = recordingSessionEffectOutput();
  createProcessStartInterpreter({
    clock,
    identities: { next: () => 'late-process' },
    resources,
    spawner: { start: () => pending.promise },
  }).execute(effect, recorded.output);
  await vi.advanceTimersByTimeAsync(10);
  pending.resolve(ownedProcess().process);
  await vi.runAllTimersAsync();
  expect(recorded.outcomes.at(-1)?.type).toBe('process.late_started');
  expect(resources.processes.get('late-process')).toBeDefined();
});

it('registers a process that appears after the reconciliation window for kernel cleanup', async () => {
  const pending = Promise.withResolvers<OwnedProcess>();
  const late = ownedProcess();
  const resources = createSessionInterpreterResources();
  registerProtocolSession(resources, session);
  const recorded = recordingSessionEffectOutput();
  createProcessStartInterpreter({
    clock,
    identities: { next: () => 'must-not-register' },
    resources,
    spawner: { start: () => pending.promise },
  }).execute(effect, recorded.output);
  await vi.advanceTimersByTimeAsync(20);
  expect(recorded.outcomes.at(-1)?.type).toBe('process.timed_out');
  pending.resolve(late.process);
  await flushMicrotasks(8);
  expect(late.terminateAndReap).not.toHaveBeenCalled();
  expect(recorded.outcomes.map(({ type }) => type)).toEqual([
    'process.timed_out',
    'process.late_started',
  ]);
  expect(resources.processes.get('must-not-register')).toBe(late.process);
});

it('contains a process rejection after the reconciliation window', async () => {
  const pending = Promise.withResolvers<OwnedProcess>();
  const resources = createSessionInterpreterResources();
  registerProtocolSession(resources, session);
  const recorded = recordingSessionEffectOutput();
  createProcessStartInterpreter({
    clock,
    identities: { next: () => 'must-not-register' },
    resources,
    spawner: { start: () => pending.promise },
  }).execute(effect, recorded.output);
  await vi.advanceTimersByTimeAsync(20);
  pending.reject(new Error('late spawn failure'));
  await flushMicrotasks(8);
  expect(recorded.outcomes).toEqual([expect.objectContaining({ type: 'process.timed_out' })]);
});

test('ignores unrelated effects and fails when preparation is missing', async () => {
  const resources = createSessionInterpreterResources();
  const recorded = recordingSessionEffectOutput();
  const interpreter = createProcessStartInterpreter({
    clock,
    identities: { next: () => 'process-1' },
    resources,
    spawner: { start: async () => ownedProcess().process },
  });
  interpreter.execute({ type: 'other' } as never, recorded.output);
  expect(recorded.outcomes).toEqual([]);
  interpreter.execute(effect, recorded.output);
  await flushMicrotasks(6);
  expect(recorded.outcomes.at(-1)).toMatchObject({ type: 'process.failed' });
});

test.each(['throw', 'reject'] as const)('contains process spawner %s failure', async (mode) => {
  const resources = createSessionInterpreterResources();
  registerProtocolSession(resources, session);
  const recorded = recordingSessionEffectOutput();
  createProcessStartInterpreter({
    clock,
    identities: { next: () => 'process-1' },
    resources,
    spawner: {
      start: () => {
        if (mode === 'throw') throw new Error('spawn failed');
        return Promise.reject(new Error('spawn failed'));
      },
    },
  }).execute(effect, recorded.output);
  await flushMicrotasks(8);
  expect(recorded.outcomes.at(-1)).toMatchObject({ type: 'process.failed' });
});

test('starts and registers a process while wiring bounded stdout and stderr collection', async () => {
  const resources = createSessionInterpreterResources();
  const preparation = registerProtocolSession(resources, session);
  const started = ownedProcess();
  const start = vi.fn<
    NonNullable<Parameters<typeof createProcessStartInterpreter>[0]['spawner']['start']>
  >(async (launch, signal) => {
    expect(signal.aborted).toBe(false);
    launch.onStdout?.(new TextEncoder().encode('out'));
    launch.onStderr?.(new TextEncoder().encode('err'));
    return started.process;
  });
  const recorded = recordingSessionEffectOutput();
  createProcessStartInterpreter({
    clock,
    identities: { next: () => 'process-1' },
    resources,
    spawner: { start },
  }).execute(effect, recorded.output);
  await flushMicrotasks(8);
  expect(recorded.outcomes.at(-1)).toMatchObject({
    processResourceId: 'process-1',
    type: 'process.started',
  });
  const output = preparation.output.finalize();
  expect(new TextDecoder().decode(output.stdout)).toBe('out');
  expect(new TextDecoder().decode(output.stderr)).toBe('err');
});

test.each([false, true])(
  'terminates a process on resource collision and contains cleanup failure=%s',
  async (cleanupFails) => {
    const resources = createSessionInterpreterResources();
    registerProtocolSession(resources, session);
    resources.processes.register('process-1', ownedProcess().process);
    const duplicate = ownedProcess();
    if (cleanupFails) duplicate.terminateAndReap.mockRejectedValueOnce(new Error('cleanup failed'));
    const recorded = recordingSessionEffectOutput();
    createProcessStartInterpreter({
      clock,
      identities: { next: () => 'process-1' },
      resources,
      spawner: { start: async () => duplicate.process },
    }).execute(effect, recorded.output);
    await flushMicrotasks(10);
    expect(duplicate.terminateAndReap).toHaveBeenCalledOnce();
    expect(recorded.outcomes.at(-1)).toMatchObject({ type: 'process.failed' });
  },
);
