import { afterEach, expect, test, vi } from 'vitest';

import type { ProcessRun } from '../../../../src/execution/process/port.js';
import { createNodeExecutableProbe } from '../../../../src/platform/node/probe/executable-probe.js';

const exitedProcess = (overrides: Partial<ProcessRun> = {}): ProcessRun => ({
  completion: Promise.resolve({ exitCode: 0, signal: null }),
  terminateAndReap: async () => ({
    status: 'confirmed',
    exit: { exitCode: 0, signal: null },
  }),
  transport: {
    input: new WritableStream(),
    output: new ReadableStream({ start: (controller) => controller.close() }),
  },
  ...overrides,
});

const brokenPipes = (): ProcessRun['transport'] => ({
  input: new WritableStream({
    close: () => {
      throw new Error('stdin already closed');
    },
  }),
  output: new ReadableStream({
    start: (controller) => controller.error(new Error('stdout closed')),
  }),
});

const startProbe = (process: ProcessRun) =>
  createNodeExecutableProbe({ start: async () => process }).startVersionProbe({
    executable: 'fixture-executable',
    args: ['--version'],
    environment: {},
    shell: false,
    stdoutLimitBytes: 65_536,
    stderrLimitBytes: 65_536,
    timeoutMs: 100,
  });

afterEach(() => vi.useRealTimers());

test('closed probe pipes do not replace the observed native exit', async () => {
  const running = await startProbe(exitedProcess({ transport: brokenPipes() }));

  await expect(running.completion).resolves.toMatchObject({
    status: 'exited',
    exitCode: 0,
    signal: null,
  });
});

test('a failed process observation cancels its deadline without fabricating an exit', async () => {
  vi.useFakeTimers();
  const failure = new Error('process observation unavailable');
  const running = await startProbe(exitedProcess({ completion: Promise.reject(failure) }));
  const timedOut = vi.fn();
  void running.timeout.then(timedOut);

  await expect(running.completion).rejects.toBe(failure);
  await vi.runAllTimersAsync();

  expect(timedOut).not.toHaveBeenCalled();
});
