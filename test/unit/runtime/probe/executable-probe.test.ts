import { expect, test } from 'vitest';

import { validateManagerOptions } from '../../../../src/runtime/definition/index.js';
import { AgentManagerError } from '../../../../src/runtime/errors/index.js';
import {
  AGENT_FAULT_MESSAGES,
  AGENT_RUNTIME_LIMITS,
} from '../../../../src/runtime/policy/index.js';
import { probeExecutable } from '../../../../src/runtime/probe/index.js';
import type { ProbeTarget, VersionProbeObservation } from '../../../../src/runtime/probe/index.js';
import { buildAgentDefinition } from '../../../support/definition/build-agent-definition.js';
import { FakeExecutableProbePort } from '../../../support/probe/fake-executable-probe-port.js';

const encoder = new TextEncoder();

const target = (input: Parameters<typeof buildAgentDefinition>[0] = {}): ProbeTarget => {
  const definition = buildAgentDefinition({
    launch: {
      command: 'fixture-agent',
      args: [{ kind: 'prompt' }, { kind: 'result-schema' }],
      versionProbe: { args: ['--version'], stream: 'stdout', prefix: 'agent ', timeoutMs: 1_000 },
    },
    constraints: { platforms: ['linux'], executableVersion: '>=1.0.0 <2.0.0' },
    ...input,
  });
  const validated = validateManagerOptions({ definitions: [definition] }).definitions[0];
  if (validated === undefined) throw new Error('Expected one validated definition.');

  return { definition: validated.definition, definitionDigest: validated.definitionDigest };
};

const resolved = (port: FakeExecutableProbePort, executable = '/links/fixture-agent'): void =>
  port.enqueueResolution({ status: 'resolved', executable });

const exited = (
  overrides: Partial<Extract<VersionProbeObservation, { status: 'exited' }>> = {},
) => ({
  status: 'exited' as const,
  exitCode: 0,
  signal: null,
  stdout: encoder.encode('agent 1.2.3\n'),
  stderr: new Uint8Array(),
  overflow: 'none' as const,
  ...overrides,
});

const unavailable = (
  targetValue: ProbeTarget,
  code:
    | 'revo.agent.probe_platform_unsupported'
    | 'revo.agent.probe_spawn_failed'
    | 'revo.agent.probe_timeout'
    | 'revo.agent.probe_output_too_large'
    | 'revo.agent.probe_process_failed'
    | 'revo.agent.probe_output_invalid'
    | 'revo.agent.probe_version_mismatch',
  message: string,
  retryable: boolean,
  details: Record<string, string | number | boolean | null>,
) => ({
  status: 'unavailable' as const,
  agent: { id: targetValue.definition.id, version: targetValue.definition.version },
  definitionDigest: targetValue.definitionDigest,
  error: { code, message, phase: 'probing' as const, retryable, details },
});

const internalProbeFault = {
  code: 'revo.agent.internal',
  message: AGENT_FAULT_MESSAGES.internalProbe,
  phase: 'probing' as const,
  retryable: false,
};

const expectInternalProbeFailure = async (operation: Promise<unknown>): Promise<void> => {
  try {
    await operation;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentManagerError);
    if (error instanceof AgentManagerError) expect(error.fault).toEqual(internalProbeFault);
    return;
  }

  throw new Error('Expected the probe operation to reject.');
};

test.each([
  ['other', 'other', { platform: 'other' }],
  ['excluded host', 'darwin', { platform: 'darwin' }],
] as const)(
  'returns platform unavailability before port activity: %s',
  async (_name, platform, details) => {
    const probeTarget = target();
    const port = new FakeExecutableProbePort({ platform });

    await expect(probeExecutable(probeTarget, port)).resolves.toEqual(
      unavailable(
        probeTarget,
        'revo.agent.probe_platform_unsupported',
        AGENT_FAULT_MESSAGES.probePlatformUnsupported,
        false,
        details,
      ),
    );
    expect(port.calls()).toEqual([]);
  },
);

test.each(['not_found', 'not_launchable'] as const)(
  'returns unavailable executable resolution without starting a version probe: %s',
  async (reason) => {
    const probeTarget = target();
    const port = new FakeExecutableProbePort({ platform: 'linux' });
    port.enqueueResolution({ status: 'unavailable', reason });

    await expect(probeExecutable(probeTarget, port)).resolves.toEqual(
      unavailable(
        probeTarget,
        'revo.agent.probe_spawn_failed',
        AGENT_FAULT_MESSAGES.probeExecutableUnavailable,
        false,
        { reason },
      ),
    );
    expect(port.calls()).toEqual([{ type: 'resolve', command: 'fixture-agent' }]);
  },
);

test('returns frozen availability without starting a probe when the definition has no version probe', async () => {
  const probeTarget = target({
    launch: { command: 'fixture-agent', args: [{ kind: 'prompt' }, { kind: 'result-schema' }] },
    constraints: { platforms: ['linux'] },
  });
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  resolved(port);

  const result = await probeExecutable(probeTarget, port);

  expect(result).toEqual({
    status: 'available',
    agent: { id: 'fixture-agent', version: '1.0.0' },
    definitionDigest: probeTarget.definitionDigest,
    executable: '/links/fixture-agent',
  });
  expect(port.calls()).toEqual([{ type: 'resolve', command: 'fixture-agent' }]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.agent)).toBe(true);
});

test('freezes every unavailable result constituent independently of the target', async () => {
  const probeTarget = target();
  const port = new FakeExecutableProbePort({ platform: 'other' });

  const result = await probeExecutable(probeTarget, port);

  expect(result.status).toBe('unavailable');
  if (result.status === 'unavailable') {
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.agent)).toBe(true);
    expect(Object.isFrozen(result.error)).toBe(true);
    expect(Object.isFrozen(result.error.details)).toBe(true);
    expect(result.agent).not.toBe(probeTarget.definition);
  }
});

test('starts one direct no-shell probe using the resolved executable and returns package-owned availability', async () => {
  const probeTarget = target();
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  resolved(port, '/links/not-realpath');
  port.enqueueVersionStart('running');
  const pending = probeExecutable(probeTarget, port);
  await Promise.resolve();
  port.settleCompletion(1, exited());

  const result = await pending;
  expect(result).toEqual({
    status: 'available',
    agent: { id: 'fixture-agent', version: '1.0.0' },
    definitionDigest: probeTarget.definitionDigest,
    executable: '/links/not-realpath',
    reportedVersion: '1.2.3',
  });
  expect(port.calls()).toEqual([
    { type: 'resolve', command: 'fixture-agent' },
    {
      type: 'start-version',
      executable: '/links/not-realpath',
      args: ['--version'],
      shell: false,
      timeoutMs: 1_000,
      stdoutLimitBytes: 65_536,
      stderrLimitBytes: 65_536,
    },
  ]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.agent)).toBe(true);
});

test('maps a controlled spawn failure', async () => {
  const probeTarget = target();
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  resolved(port);
  port.enqueueVersionStart('running');
  const pending = probeExecutable(probeTarget, port);
  await Promise.resolve();
  port.settleCompletion(1, { status: 'spawn_failed' });

  await expect(pending).resolves.toEqual(
    unavailable(
      probeTarget,
      'revo.agent.probe_spawn_failed',
      AGENT_FAULT_MESSAGES.probeStartFailed,
      true,
      { reason: 'spawn_failed' },
    ),
  );
});

test('waits for successful timeout termination and reaping before returning timeout', async () => {
  const probeTarget = target();
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  resolved(port);
  port.enqueueVersionStart('running');
  let settled = false;
  const pending = probeExecutable(probeTarget, port).then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  port.fireTimeout(1);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(settled).toBe(false);
  expect(port.calls()).toEqual([
    { type: 'resolve', command: 'fixture-agent' },
    {
      type: 'start-version',
      executable: '/links/fixture-agent',
      args: ['--version'],
      shell: false,
      timeoutMs: 1_000,
      stdoutLimitBytes: 65_536,
      stderrLimitBytes: 65_536,
    },
    { type: 'terminate-and-reap', probeId: 1 },
  ]);
  port.settleTermination(1);

  await expect(pending).resolves.toEqual(
    unavailable(probeTarget, 'revo.agent.probe_timeout', AGENT_FAULT_MESSAGES.probeTimeout, true, {
      timeoutMs: 1_000,
    }),
  );
});

test.each(['stdout', 'stderr', 'both'] as const)(
  'maps %s overflow before process output',
  async (overflow) => {
    const probeTarget = target();
    const port = new FakeExecutableProbePort({ platform: 'linux' });
    resolved(port);
    port.enqueueVersionStart('running');
    const pending = probeExecutable(probeTarget, port);
    await Promise.resolve();
    port.settleCompletion(1, exited({ overflow, exitCode: 2, stdout: encoder.encode('bad') }));

    await expect(pending).resolves.toEqual(
      unavailable(
        probeTarget,
        'revo.agent.probe_output_too_large',
        AGENT_FAULT_MESSAGES.probeOutputTooLarge,
        false,
        { stream: overflow, limitBytes: AGENT_RUNTIME_LIMITS.probeStreamBytes },
      ),
    );
  },
);

test('maps unsuccessful process exit before selected output parsing', async () => {
  const probeTarget = target();
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  resolved(port);
  port.enqueueVersionStart('running');
  const pending = probeExecutable(probeTarget, port);
  await Promise.resolve();
  port.settleCompletion(1, exited({ exitCode: 2, signal: null, stdout: encoder.encode('bad') }));

  await expect(pending).resolves.toEqual(
    unavailable(
      probeTarget,
      'revo.agent.probe_process_failed',
      AGENT_FAULT_MESSAGES.probeProcessFailed,
      false,
      { exitCode: 2, signal: null },
    ),
  );
});

const outputCases = [
  [new Uint8Array([0xc3, 0x28]), 'invalid_utf8', 'agent '],
  [encoder.encode('agent 1.2.3\0'), 'nul', 'agent '],
  [encoder.encode('agent 1.2.3\nnext'), 'line_break', 'agent '],
  [encoder.encode(' agent 1.2.3'), 'surrounding_whitespace', 'agent '],
  [encoder.encode('Agent 1.2.3'), 'prefix_mismatch', 'agent '],
  [encoder.encode('agent'), 'empty_version', 'agent'],
  [encoder.encode('agent v1.2.3'), 'invalid_semver', 'agent '],
] as const;

const selectedOutputCases = (['stdout', 'stderr'] as const).flatMap((stream) =>
  outputCases.map(([bytes, reason, prefix]) => [reason, stream, bytes, prefix] as const),
);

test.each(selectedOutputCases)(
  'maps %s from the selected %s only',
  async (reason, stream, bytes, prefix) => {
    const probeTarget = target({
      launch: {
        command: 'fixture-agent',
        args: [{ kind: 'prompt' }, { kind: 'result-schema' }],
        versionProbe: { args: ['--version'], stream, prefix, timeoutMs: 1_000 },
      },
      constraints: { platforms: ['linux'], executableVersion: '>=1.0.0 <2.0.0' },
    });
    const port = new FakeExecutableProbePort({ platform: 'linux' });
    resolved(port);
    port.enqueueVersionStart('running');
    const pending = probeExecutable(probeTarget, port);
    await Promise.resolve();
    port.settleCompletion(
      1,
      exited({
        stdout: stream === 'stdout' ? bytes : encoder.encode('agent 1.2.3'),
        stderr: stream === 'stderr' ? bytes : encoder.encode('not selected'),
      }),
    );

    await expect(pending).resolves.toEqual(
      unavailable(
        probeTarget,
        'revo.agent.probe_output_invalid',
        AGENT_FAULT_MESSAGES.probeOutputInvalid,
        false,
        { stream, reason },
      ),
    );
  },
);

test.each([
  [1_018, false],
  [1_019, true],
] as const)('maps a %i-byte reported version preview safely', async (buildLength, truncated) => {
  const reported = `1.0.0+${'a'.repeat(buildLength)}`;
  const constraint = `${'>=2.0.0 '.repeat(128)}>=2.0.0`;
  const probeTarget = target({
    launch: {
      command: 'fixture-agent',
      args: [{ kind: 'prompt' }, { kind: 'result-schema' }],
      versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
    },
    constraints: { platforms: ['linux'], executableVersion: constraint },
  });
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  resolved(port);
  port.enqueueVersionStart('running');
  const pending = probeExecutable(probeTarget, port);
  await Promise.resolve();
  port.settleCompletion(1, exited({ stdout: encoder.encode(reported) }));

  await expect(pending).resolves.toEqual(
    unavailable(
      probeTarget,
      'revo.agent.probe_version_mismatch',
      AGENT_FAULT_MESSAGES.probeVersionMismatch,
      false,
      {
        reportedVersionPreview: reported.slice(0, 1_024),
        reportedVersionTruncated: truncated,
        constraintPreview: constraint.slice(0, 1_024),
        constraintTruncated: true,
      },
    ),
  );
});

test('gives a timeout precedence over a coincident failed completion', async () => {
  const probeTarget = target();
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  resolved(port);
  port.enqueueVersionStart('running');
  const pending = probeExecutable(probeTarget, port);
  await Promise.resolve();
  port.fireTimeout(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  port.settleCompletion(
    1,
    exited({ overflow: 'both', exitCode: 2, stdout: encoder.encode('bad') }),
  );
  port.settleTermination(1);

  await expect(pending).resolves.toEqual(
    unavailable(probeTarget, 'revo.agent.probe_timeout', AGENT_FAULT_MESSAGES.probeTimeout, true, {
      timeoutMs: 1_000,
    }),
  );
});

test('rejects unexpected port failures and failed reap with the stable internal fault', async () => {
  const probeTarget = target();
  const throwingPort = new FakeExecutableProbePort({ platform: 'linux' });
  throwingPort.enqueueResolution(new Error('raw resolution failure'));
  await expectInternalProbeFailure(probeExecutable(probeTarget, throwingPort));

  const port = new FakeExecutableProbePort({ platform: 'linux' });
  resolved(port);
  port.enqueueVersionStart('running');
  const pending = probeExecutable(probeTarget, port);
  await Promise.resolve();
  port.fireTimeout(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  port.settleTermination(1, new Error('raw reap failure'));
  await expectInternalProbeFailure(pending);
});

test.each([
  [
    'start rejection',
    (port: FakeExecutableProbePort) => port.enqueueVersionStart(new Error('raw start failure')),
  ],
  [
    'completion rejection',
    (port: FakeExecutableProbePort) => {
      port.enqueueVersionStart('running');
      return port;
    },
  ],
] as const)('rejects unexpected %s', async (name, arrange) => {
  const probeTarget = target();
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  resolved(port);
  arrange(port);
  const pending = probeExecutable(probeTarget, port);

  if (name === 'completion rejection') {
    await Promise.resolve();
    port.settleCompletion(1, new Error('raw completion failure'));
  }

  await expectInternalProbeFailure(pending);
});

test.each([
  ['invalid resolution', (value: object) => Reflect.set(value, 'status', 'impossible')],
  ['invalid resolution reason', (value: object) => Reflect.set(value, 'reason', 'impossible')],
  ['invalid overflow', (value: object) => Reflect.set(value, 'overflow', 'impossible')],
  ['fractional exit code', (value: object) => Reflect.set(value, 'exitCode', 0.5)],
  ['negative exit code', (value: object) => Reflect.set(value, 'exitCode', -1)],
  ['unbounded signal', (value: object) => Reflect.set(value, 'signal', `SIG${'A'.repeat(1_024)}`)],
] as const)('rejects an unexpected %s invariant without exposing it', async (_name, corrupt) => {
  const probeTarget = target();
  const port = new FakeExecutableProbePort({ platform: 'linux' });

  if (_name === 'invalid resolution' || _name === 'invalid resolution reason') {
    if (_name === 'invalid resolution') {
      const resolution = { status: 'resolved' as const, executable: '/links/fixture-agent' };
      port.enqueueResolution(resolution);
      corrupt(resolution);
    } else {
      const resolution = { status: 'unavailable' as const, reason: 'not_found' as const };
      port.enqueueResolution(resolution);
      corrupt(resolution);
    }
    await expectInternalProbeFailure(probeExecutable(probeTarget, port));
    return;
  }

  resolved(port);
  port.enqueueVersionStart('running');
  const pending = probeExecutable(probeTarget, port);
  await Promise.resolve();
  const observation = exited();
  corrupt(observation);
  port.settleCompletion(1, observation);
  await expectInternalProbeFailure(pending);
});
