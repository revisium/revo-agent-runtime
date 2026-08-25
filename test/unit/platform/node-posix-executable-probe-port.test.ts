import { expect, test } from 'vitest';

import { NodePosixExecutableProbePort } from '../../../src/platform/process/index.js';
import type {
  BoundedCommandObservation,
  RunningBoundedCommand,
} from '../../../src/runtime/execution/index.js';
import { FakeBoundedCommandPort } from '../../support/execution/fake-bounded-command-port.js';

const observation: BoundedCommandObservation = Object.freeze({
  status: 'exited',
  exitCode: 0,
  signal: null,
  stdout: new Uint8Array([1]),
  stderr: new Uint8Array([2]),
  overflow: 'none',
});

const running: RunningBoundedCommand = Object.freeze({
  completion: Promise.resolve(observation),
  timeout: Promise.resolve(),
  terminateAndReap: async () => undefined,
});

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
if (platformDescriptor === undefined) throw new Error('Expected process.platform descriptor.');

test.each([
  ['linux', 'linux'],
  ['darwin', 'darwin'],
  ['win32', 'win32'],
  ['freebsd', 'other'],
] as const)('maps host platform %s to %s', (platform, expected) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    expect(new NodePosixExecutableProbePort(Object.freeze({})).hostPlatform()).toBe(expected);
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor);
  }
});

test('forwards resolve requests and returns both resolution shapes verbatim', async () => {
  const command = new FakeBoundedCommandPort();
  const environment = Object.freeze({ PATH: '/fixture/bin' });
  const port = new NodePosixExecutableProbePort(environment, command);
  const resolved = Object.freeze({ status: 'resolved' as const, executable: '/fixture/bin/agent' });
  const unavailable = Object.freeze({
    status: 'unavailable' as const,
    reason: 'not_found' as const,
  });
  command.resolutions.push(resolved, unavailable);

  await expect(port.resolveExecutable({ command: 'agent' })).resolves.toBe(resolved);
  await expect(port.resolveExecutable({ command: 'missing' })).resolves.toBe(unavailable);
  expect(command.calls).toEqual([
    { type: 'resolve', request: { command: 'agent', args: [], environment } },
    { type: 'resolve', request: { command: 'missing', args: [], environment } },
  ]);
});

test('maps version probe requests and returns the running command verbatim', async () => {
  const command = new FakeBoundedCommandPort();
  const environment = Object.freeze({ PATH: '/fixture/bin' });
  const port = new NodePosixExecutableProbePort(environment, command);
  command.starts.push(running);
  const request = {
    executable: '/fixture/bin/agent',
    args: ['--version'],
    shell: false as const,
    timeoutMs: 250,
    stdoutLimitBytes: 65_536 as const,
    stderrLimitBytes: 65_536 as const,
  };

  await expect(port.startVersionProbe(request)).resolves.toBe(running);
  expect(command.calls).toEqual([
    {
      type: 'start',
      request: {
        command: request.executable,
        args: request.args,
        environment,
        timeoutMs: request.timeoutMs,
        maxStdoutBytes: request.stdoutLimitBytes,
        maxStderrBytes: request.stderrLimitBytes,
      },
    },
  ]);
});

test('uses one injected environment object for resolve and start', async () => {
  const command = new FakeBoundedCommandPort();
  const environment = Object.freeze({ PATH: '/fixture/bin', HOME: '/fixture/home' });
  const port = new NodePosixExecutableProbePort(environment, command);
  command.resolutions.push({ status: 'resolved', executable: '/fixture/bin/agent' });
  command.starts.push(running);

  await port.resolveExecutable({ command: 'agent' });
  await port.startVersionProbe({
    executable: '/fixture/bin/agent',
    args: [],
    shell: false,
    timeoutMs: 250,
    stdoutLimitBytes: 65_536,
    stderrLimitBytes: 65_536,
  });

  const requests = command.calls.map((call) => call.request);
  expect(requests).toHaveLength(2);
  expect(requests[0]?.environment).toBe(environment);
  expect(requests[1]?.environment).toBe(environment);
  expect(Object.keys(environment)).toEqual(['PATH', 'HOME']);
});

test('uses the bounded command port by default', async () => {
  const port = new NodePosixExecutableProbePort(Object.freeze({ PATH: process.env.PATH ?? '' }));
  await expect(port.resolveExecutable({ command: process.execPath })).resolves.toEqual({
    status: 'resolved',
    executable: process.execPath,
  });
});
