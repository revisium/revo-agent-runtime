import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
