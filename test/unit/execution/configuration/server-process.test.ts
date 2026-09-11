import { expect, test, vi } from 'vitest';

import { createConfigurationServerSpawner } from '../../../../src/execution/configuration/server-process.js';
import { ProcessStartError, type OwnedProcess } from '../../../../src/process/index.js';
import { processIdentity } from '../../../support/builders/process-identity.js';

test('adapts a started process without changing the request or signal', async () => {
  const process: OwnedProcess = {
    completion: Promise.resolve({ exitCode: 0, signal: null }),
    identity: processIdentity(),
    terminateAndReap: vi.fn(async () => ({
      exit: { exitCode: 0, signal: null },
      status: 'confirmed' as const,
    })),
    transport: { input: new WritableStream(), output: new ReadableStream() },
  };
  const start = vi.fn(async (request: unknown, signal: AbortSignal) => {
    expect(request).toMatchObject({ command: 'opencode' });
    expect(signal).toBeInstanceOf(AbortSignal);
    return process;
  });
  const signal = new AbortController().signal;
  const result = await createConfigurationServerSpawner({ start }).start(
    {
      args: ['serve'],
      command: 'opencode',
      cwd: '/workspace',
      environment: {},
      onStdout: () => undefined,
    },
    signal,
  );
  expect(result).toBe(process);
  expect(start).toHaveBeenCalledOnce();
});

test.each([
  ['confirmed', false],
  ['uncertain', true],
] as const)('preserves process startup cleanup state (%s)', async (cleanup, uncertain) => {
  const start = vi.fn(async () => {
    throw new ProcessStartError(cleanup);
  });
  await expect(
    createConfigurationServerSpawner({ start }).start(
      {
        args: ['serve'],
        command: 'opencode',
        cwd: '/workspace',
        environment: {},
        onStdout: () => undefined,
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ cleanupUncertain: uncertain });
});

test('passes through non-process startup errors', async () => {
  const failure = new Error('unexpected');
  const start = vi.fn(async () => {
    throw failure;
  });
  await expect(
    createConfigurationServerSpawner({ start }).start(
      {
        args: ['serve'],
        command: 'opencode',
        cwd: '/workspace',
        environment: {},
        onStdout: () => undefined,
      },
      new AbortController().signal,
    ),
  ).rejects.toBe(failure);
});
