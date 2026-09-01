import { expect, test } from 'vitest';

import { AgentManagerError } from '../../../../src/contracts/manager.js';
import { agentManagerProbeStory } from '../../../support/stories/agent-manager-probe.js';

const expectManagerFault = async (
  operation: Promise<unknown>,
  expected: Readonly<Record<string, unknown>>,
): Promise<void> => {
  try {
    await operation;
    throw new Error('Expected AgentManagerError.');
  } catch (error) {
    expect(error).toBeInstanceOf(AgentManagerError);
    if (!(error instanceof AgentManagerError)) return;
    expect(error.fault).toMatchObject(expected);
  }
};

test('requires an initialized and open manager', async () => {
  const subject = agentManagerProbeStory();

  await expectManagerFault(subject.manager.probeAgent(subject.agent), {
    code: 'revo.agent.manager_not_initialized',
    phase: 'manager',
    retryable: false,
  });

  await subject.manager.initialize([]);
  await subject.manager.shutdown();

  await expectManagerFault(subject.manager.probeAgent(subject.agent), {
    code: 'revo.agent.manager_closed',
    phase: 'manager',
    retryable: false,
  });
});

test('rejects an unknown exact agent reference without beginning a probe', async () => {
  const subject = agentManagerProbeStory();
  await subject.manager.initialize([]);

  await expectManagerFault(subject.manager.probeAgent({ id: 'missing', version: '2.0.0' }), {
    code: 'revo.agent.agent_unknown',
    phase: 'probing',
    retryable: false,
  });
  expect(subject.probeCalls()).toBe(0);

  await subject.manager.shutdown();
});

test('returns a package-owned observation instead of executable facts from the definition', async () => {
  const subject = agentManagerProbeStory();
  await subject.manager.initialize([]);
  subject.plan('available');

  const result = await subject.manager.probeAgent(subject.agent);

  expect(result).toEqual({
    agent: { id: 'runtime-agent', version: '2.0.0' },
    definitionDigest: subject.definitionDigest(),
    executable: '/resolved/runtime-agent',
    reportedVersion: '2.4.0',
    status: 'available',
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.agent)).toBe(true);
  expect(result.agent).not.toBe(subject.agent);
  expect(result).not.toHaveProperty('definition');

  await subject.manager.shutdown();
});

test.each([
  ['platform unsupported', 'platform_unsupported', 'revo.agent.probe_platform_unsupported', false],
  ['executable not found', 'executable_not_found', 'revo.agent.probe_spawn_failed', false],
  [
    'executable not launchable',
    'executable_not_launchable',
    'revo.agent.probe_spawn_failed',
    false,
  ],
  ['version probe cannot start', 'probe_spawn_failed', 'revo.agent.probe_spawn_failed', true],
  ['version probe timeout', 'probe_timeout', 'revo.agent.probe_timeout', true],
  [
    'probe output exceeds its bound',
    'probe_output_too_large',
    'revo.agent.probe_output_too_large',
    false,
  ],
  [
    'probe process exits unsuccessfully',
    'probe_process_failed',
    'revo.agent.probe_process_failed',
    false,
  ],
  ['probe output is invalid', 'probe_output_invalid', 'revo.agent.probe_output_invalid', false],
] as const)(
  'returns an unavailable observation when %s',
  async (_description, scenario, code, retryable) => {
    const subject = agentManagerProbeStory();
    await subject.manager.initialize([]);
    subject.plan(scenario);

    await expect(subject.manager.probeAgent(subject.agent)).resolves.toMatchObject({
      agent: subject.agent,
      definitionDigest: subject.definitionDigest(),
      error: { code, phase: 'probing', retryable },
      status: 'unavailable',
    });

    await subject.manager.shutdown();
  },
);

test('fails closed when probe cleanup cannot be confirmed', async () => {
  const subject = agentManagerProbeStory();
  await subject.manager.initialize([]);
  subject.plan('probe_cleanup_failed');

  await expectManagerFault(subject.manager.probeAgent(subject.agent), {
    code: 'revo.agent.internal',
    phase: 'probing',
    retryable: false,
  });

  await subject.manager.shutdown();
});

test.each(['aborted', 'throws'] as const)(
  'fails closed when executable preflight reports an internal %s outcome',
  async (scenario) => {
    const subject = agentManagerProbeStory();
    await subject.manager.initialize([]);
    subject.plan(scenario);

    await expectManagerFault(subject.manager.probeAgent(subject.agent), {
      code: 'revo.agent.internal',
      phase: 'probing',
      retryable: false,
    });

    await subject.manager.shutdown();
  },
);

test('aborts a pending probe, reaps it before shutdown settles, and withholds availability', async () => {
  const subject = agentManagerProbeStory();
  await subject.manager.initialize([]);
  subject.plan('pending');

  const probe = subject.manager.probeAgent(subject.agent);
  await subject.waitForProbe();
  const shutdown = subject.manager.shutdown();
  await subject.waitForCleanup();

  let shutdownSettled = false;
  void shutdown.then(() => {
    shutdownSettled = true;
  });
  await Promise.resolve();
  expect(shutdownSettled).toBe(false);

  subject.confirmCleanup();
  await expect(shutdown).resolves.toBeUndefined();
  await expectManagerFault(probe, {
    code: 'revo.agent.manager_closed',
    phase: 'manager',
    retryable: false,
  });
});

test('does a fresh probe before a later start rather than reusing a public observation', async () => {
  const subject = agentManagerProbeStory();
  await subject.manager.initialize([]);
  subject.plan('available');
  await expect(subject.manager.probeAgent(subject.agent)).resolves.toMatchObject({
    status: 'available',
  });

  subject.plan('available');
  const handle = await subject.start();
  await expect(handle.result()).resolves.toMatchObject({ status: 'succeeded' });
  expect(subject.probeCalls()).toBe(2);

  await subject.manager.shutdown();
});
