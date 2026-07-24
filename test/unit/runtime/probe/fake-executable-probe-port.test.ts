import { expect, test } from 'vitest';

import type {
  ExecutableResolution,
  VersionProbeObservation,
  VersionProbeRequest,
} from '../../../../src/runtime/probe/index.js';
import {
  FakeExecutableProbePort,
  type ProbePortCall,
} from '../../../support/probe/fake-executable-probe-port.js';

const versionRequest = (overrides: Partial<VersionProbeRequest> = {}): VersionProbeRequest => ({
  executable: '/resolved/agent',
  args: ['--version'],
  shell: false,
  timeoutMs: 1_000,
  stdoutLimitBytes: 65_536,
  stderrLimitBytes: 65_536,
  ...overrides,
});

const exited = (
  overrides: Partial<Extract<VersionProbeObservation, { status: 'exited' }>> = {},
): VersionProbeObservation => ({
  status: 'exited',
  exitCode: 0,
  signal: null,
  stdout: new Uint8Array([49, 46, 50, 46, 51]),
  stderr: new Uint8Array([]),
  overflow: 'none',
  ...overrides,
});

test('returns the configured provider-neutral host platform and counts every read', () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });

  expect(port.hostPlatformReadCount()).toBe(0);
  expect(port.hostPlatform()).toBe('linux');
  expect(port.hostPlatformReadCount()).toBe(1);
  expect(port.hostPlatform()).toBe('linux');
  expect(port.hostPlatformReadCount()).toBe(2);
});

test('resolves queued executable scripts in FIFO order and retains queued errors', async () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  const unavailable: ExecutableResolution = { status: 'unavailable', reason: 'not_found' };
  const failure = new Error('resolution failed');

  port.enqueueResolution(unavailable);
  port.enqueueResolution(failure);

  await expect(port.resolveExecutable({ command: 'agent' })).resolves.toEqual(unavailable);
  await expect(port.resolveExecutable({ command: 'agent' })).rejects.toBe(failure);
  await expect(port.resolveExecutable({ command: 'agent' })).rejects.toThrow(
    'No resolution result is queued',
  );
});

test('starts queued version scripts in FIFO order and allocates ids only for running probes', async () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  const failure = new Error('start failed');

  port.enqueueVersionStart(failure);
  port.enqueueVersionStart('running');

  await expect(port.startVersionProbe(versionRequest())).rejects.toBe(failure);
  expect(port.activeVersionProbes()).toBe(0);
  const runningProbe = await port.startVersionProbe(versionRequest());

  expect(port.activeVersionProbes()).toBe(1);
  expect(port.maximumActiveVersionProbes()).toBe(1);
  port.settleCompletion(1, exited());
  await expect(runningProbe.completion).resolves.toMatchObject({ status: 'exited' });
  await expect(port.startVersionProbe(versionRequest())).rejects.toThrow(
    'No version start result is queued',
  );
});

test('records copied and frozen no-shell start request data in the call snapshot', async () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  const args = ['--version'];
  const request = versionRequest({ args });

  port.enqueueVersionStart('running');
  await port.startVersionProbe(request);
  args.push('--changed-after-start');

  const calls = port.calls();
  const [call] = calls;

  expect(calls).toEqual([
    {
      type: 'start-version',
      executable: '/resolved/agent',
      args: ['--version'],
      shell: false,
      timeoutMs: 1_000,
      stdoutLimitBytes: 65_536,
      stderrLimitBytes: 65_536,
    },
  ] satisfies readonly ProbePortCall[]);
  expect(Object.isFrozen(calls)).toBe(true);
  expect(Object.isFrozen(call)).toBe(true);
  expect(Object.isFrozen(call?.type === 'start-version' ? call.args : [])).toBe(true);
});

test('records complete ordered immutable resolution, start, and termination calls', async () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });

  port.enqueueResolution({ status: 'resolved', executable: '/bin/agent' });
  port.enqueueVersionStart('running');

  await port.resolveExecutable({ command: 'agent' });
  const probe = await port.startVersionProbe(versionRequest());
  const termination = probe.terminateAndReap();

  expect(port.calls()).toEqual([
    { type: 'resolve', command: 'agent' },
    {
      type: 'start-version',
      executable: '/resolved/agent',
      args: ['--version'],
      shell: false,
      timeoutMs: 1_000,
      stdoutLimitBytes: 65_536,
      stderrLimitBytes: 65_536,
    },
    { type: 'terminate-and-reap', probeId: 1 },
  ] satisfies readonly ProbePortCall[]);
  port.settleTermination(1);
  await expect(termination).resolves.toBeUndefined();
});

test('settles completion with copied bytes and decrements active probes only once', async () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  const source = exited();

  port.enqueueVersionStart('running');
  const probe = await port.startVersionProbe(versionRequest());
  port.settleCompletion(1, source);
  if (source.status === 'exited') {
    source.stdout[0] = 57;
  }

  const observation = await probe.completion;
  expect(observation).toEqual(exited());
  expect(Object.isFrozen(observation)).toBe(true);
  expect(port.activeVersionProbes()).toBe(0);
  expect(() => port.settleCompletion(1, exited())).toThrow(
    'Completion for probe 1 is already settled',
  );
  expect(port.activeVersionProbes()).toBe(0);
});

test('fires timeout without completing or decrementing an active probe', async () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });

  port.enqueueVersionStart('running');
  const probe = await port.startVersionProbe(versionRequest());
  port.fireTimeout(1);

  await expect(probe.timeout).resolves.toBeUndefined();
  expect(port.activeVersionProbes()).toBe(1);
  port.settleCompletion(1, exited());
  await expect(probe.completion).resolves.toMatchObject({ status: 'exited' });
  expect(port.activeVersionProbes()).toBe(0);
  expect(() => port.fireTimeout(1)).toThrow('Timeout for probe 1 is already settled');
});

test('keeps termination pending until its scripted settlement and retains exact errors', async () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  const failure = new Error('reap failed');

  port.enqueueVersionStart('running');
  const first = await port.startVersionProbe(versionRequest());
  const pendingTermination = first.terminateAndReap();
  let settled = false;
  void pendingTermination.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  expect(settled).toBe(false);

  port.settleTermination(1, failure);
  await expect(pendingTermination).rejects.toBe(failure);
  expect(port.activeVersionProbes()).toBe(1);

  port.enqueueVersionStart('running');
  const second = await port.startVersionProbe(versionRequest());
  const successfulTermination = second.terminateAndReap();
  port.settleTermination(2);
  await expect(successfulTermination).resolves.toBeUndefined();
  expect(port.activeVersionProbes()).toBe(1);
});

test('tracks active and maximum probes across concurrent completion, timeout, and reaping', async () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });

  port.enqueueVersionStart('running');
  port.enqueueVersionStart('running');
  port.enqueueVersionStart('running');
  const first = await port.startVersionProbe(versionRequest());
  const second = await port.startVersionProbe(versionRequest());
  const third = await port.startVersionProbe(versionRequest());

  expect(port.activeVersionProbes()).toBe(3);
  expect(port.maximumActiveVersionProbes()).toBe(3);
  port.settleCompletion(1, exited());
  port.fireTimeout(2);
  const thirdTermination = third.terminateAndReap();
  port.settleTermination(3);

  await expect(first.completion).resolves.toMatchObject({ status: 'exited' });
  await expect(second.timeout).resolves.toBeUndefined();
  await expect(thirdTermination).resolves.toBeUndefined();
  expect(port.activeVersionProbes()).toBe(1);
  expect(port.maximumActiveVersionProbes()).toBe(3);
});

test('rejects unknown ids and duplicate settlements for each probe channel', async () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });

  expect(() => port.settleCompletion(1, exited())).toThrow('Unknown probe id 1');
  expect(() => port.fireTimeout(1)).toThrow('Unknown probe id 1');
  expect(() => port.settleTermination(1)).toThrow('Unknown probe id 1');

  port.enqueueVersionStart('running');
  const probe = await port.startVersionProbe(versionRequest());
  port.settleCompletion(1, exited());
  port.fireTimeout(1);
  const termination = probe.terminateAndReap();
  port.settleTermination(1);
  await expect(termination).resolves.toBeUndefined();

  expect(() => port.settleCompletion(1, exited())).toThrow(
    'Completion for probe 1 is already settled',
  );
  expect(() => port.fireTimeout(1)).toThrow('Timeout for probe 1 is already settled');
  expect(() => port.settleTermination(1)).toThrow('Termination for probe 1 is already settled');
});
