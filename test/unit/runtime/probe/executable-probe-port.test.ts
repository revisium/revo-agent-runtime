import { expect, test } from 'vitest';

import type {
  ExecutableProbePort,
  RunningVersionProbe,
  VersionProbeObservation,
  VersionProbeRequest,
} from '../../../../src/runtime/probe/index.js';

const observation: VersionProbeObservation = {
  status: 'exited',
  exitCode: 0,
  signal: null,
  stdout: new Uint8Array([49, 46, 50, 46, 51]),
  stderr: new Uint8Array([]),
  overflow: 'none',
};

const runningProbe: RunningVersionProbe = {
  completion: Promise.resolve(observation),
  timeout: new Promise(() => undefined),
  terminateAndReap: async () => undefined,
};

const port: ExecutableProbePort = {
  hostPlatform: () => 'linux',
  resolveExecutable: async ({ command }) => ({
    status: 'resolved',
    executable: `/resolved/${command}`,
  }),
  startVersionProbe: async () => runningProbe,
};

const request: VersionProbeRequest = {
  executable: '/resolved/agent',
  args: ['--version'],
  shell: false,
  timeoutMs: 1_000,
  stdoutLimitBytes: 65_536,
  stderrLimitBytes: 65_536,
};

test('exposes the raw executable probe observables through the provider-neutral port', async () => {
  expect(port.hostPlatform()).toBe('linux');
  await expect(port.resolveExecutable({ command: 'agent' })).resolves.toEqual({
    status: 'resolved',
    executable: '/resolved/agent',
  });

  const probe = await port.startVersionProbe(request);
  await expect(probe.completion).resolves.toBe(observation);
  expect(request.shell).toBe(false);
  expect(request.stdoutLimitBytes).toBe(65_536);
  expect(request.stderrLimitBytes).toBe(65_536);
});
