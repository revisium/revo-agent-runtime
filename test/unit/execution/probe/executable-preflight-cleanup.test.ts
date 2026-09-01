import { expect, test } from 'vitest';

import { validateAgentDefinition } from '../../../../src/definition/index.js';
import { createExecutablePreflight } from '../../../../src/execution/probe/executable-preflight.js';
import type { ExecutableProbePort } from '../../../../src/execution/probe/port.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { executableProbeStory, exitedProbe } from '../../../support/stories/executable-probe.js';

const probe = async (
  story: ReturnType<typeof executableProbeStory>,
  overrides: Parameters<typeof agentDefinition>[0] = {},
) =>
  createExecutablePreflight(story.port).probe(
    validateAgentDefinition(agentDefinition(overrides)).definition,
    new AbortController().signal,
  );
test.each([
  ['overflow', exitedProbe('1.0.0', { overflow: 'stdout' }), 'probe_output_too_large'],
  ['nonzero exit', exitedProbe('1.0.0', { exitCode: 3 }), 'probe_process_failed'],
  [
    'signal exit',
    exitedProbe('1.0.0', { exitCode: null, signal: 'SIGTERM' }),
    'probe_process_failed',
  ],
  ['spawn failure', { status: 'spawn_failed' }, 'probe_spawn_failed'],
] as const)('classifies %s without exposing process output', async (_name, observation, reason) => {
  await expect(probe(executableProbeStory({ observation }))).resolves.toEqual({
    reason,
    status: 'rejected',
  });
});

test('terminates and reaps a timed-out probe', async () => {
  const story = executableProbeStory({ timeout: true });
  await expect(probe(story)).resolves.toEqual({ reason: 'probe_timeout', status: 'rejected' });
  expect(story.calls.at(-1)).toEqual({ type: 'terminate' });
});

test('fails closed when timed-out probe cleanup cannot be confirmed', async () => {
  await expect(probe(executableProbeStory({ cleanupFails: true, timeout: true }))).resolves.toEqual(
    { reason: 'probe_cleanup_failed', status: 'rejected' },
  );
});

test('contains a failed probe observation only after cleanup', async () => {
  const story = executableProbeStory({ observation: new Error('fixture observation failed') });
  await expect(probe(story)).resolves.toEqual({ reason: 'probe_spawn_failed', status: 'rejected' });
  expect(story.calls.at(-1)).toEqual({ type: 'terminate' });
});

test('each preflight performs a fresh resolution and version probe', async () => {
  const story = executableProbeStory();
  const preflight = createExecutablePreflight(story.port);
  const definition = validateAgentDefinition(agentDefinition()).definition;

  await preflight.probe(definition, new AbortController().signal);
  await preflight.probe(definition, new AbortController().signal);

  expect(story.calls.map((call) => call.type)).toEqual([
    'resolve',
    'version',
    'resolve',
    'version',
  ]);
});

test('contains resolution and version-start adapter failures', async () => {
  await expect(
    probe(executableProbeStory({ resolution: new Error('lookup failed') })),
  ).resolves.toEqual({ reason: 'executable_not_found', status: 'rejected' });
  const story = executableProbeStory();
  const failingStart: ExecutableProbePort = {
    ...story.port,
    startVersionProbe: async () => {
      throw new Error('spawn failed');
    },
  };
  await expect(
    createExecutablePreflight(failingStart).probe(
      validateAgentDefinition(agentDefinition()).definition,
      new AbortController().signal,
    ),
  ).resolves.toEqual({ reason: 'probe_spawn_failed', status: 'rejected' });
});

test('cancellation before, after resolution, and during a probe stays preflight-only', async () => {
  const definition = validateAgentDefinition(agentDefinition()).definition;
  const before = new AbortController();
  before.abort();
  const untouched = executableProbeStory();
  await expect(
    createExecutablePreflight(untouched.port).probe(definition, before.signal),
  ).resolves.toEqual({
    status: 'aborted',
  });
  expect(untouched.calls).toEqual([]);

  const afterResolution = new AbortController();
  const resolved = executableProbeStory();
  const abortingResolution: ExecutableProbePort = {
    ...resolved.port,
    resolveExecutable: async (command) => {
      const result = await resolved.port.resolveExecutable(command);
      afterResolution.abort();
      return result;
    },
  };
  await expect(
    createExecutablePreflight(abortingResolution).probe(definition, afterResolution.signal),
  ).resolves.toEqual({ status: 'aborted' });
  expect(resolved.calls.map((call) => call.type)).toEqual(['resolve']);

  const during = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const pending: ExecutableProbePort = {
    hostPlatform: () => 'linux',
    resolveExecutable: async () => ({ executable: '/resolved/agent', status: 'resolved' }),
    startVersionProbe: async () => {
      markStarted();
      return {
        completion: new Promise(() => undefined),
        terminateAndReap: async () => undefined,
        timeout: new Promise(() => undefined),
      };
    },
  };
  const result = createExecutablePreflight(pending).probe(definition, during.signal);
  await started;
  await Promise.resolve();
  during.abort();
  await expect(result).resolves.toEqual({ status: 'aborted' });
});

test('validates adapter resolutions against the host path format', async () => {
  await expect(
    probe(
      executableProbeStory({ resolution: { executable: 'relative/agent', status: 'resolved' } }),
    ),
  ).resolves.toEqual({ reason: 'executable_not_launchable', status: 'rejected' });
  await expect(
    probe(
      executableProbeStory({
        platform: 'win32',
        resolution: { executable: 'C:\\Agent\\agent.exe', status: 'resolved' },
      }),
    ),
  ).resolves.toMatchObject({ status: 'ready' });
});

test('cleanup failure after observation rejection remains failed closed', async () => {
  await expect(
    probe(
      executableProbeStory({
        cleanupFails: true,
        observation: new Error('observation failed'),
      }),
    ),
  ).resolves.toEqual({ reason: 'probe_cleanup_failed', status: 'rejected' });
});
