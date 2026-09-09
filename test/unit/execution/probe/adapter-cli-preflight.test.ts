import { expect, test } from 'vitest';

import { validateAgentDefinition } from '../../../../src/definition/index.js';
import { createExecutablePreflight } from '../../../../src/execution/probe/executable-preflight.js';
import type { ExecutableResolution } from '../../../../src/execution/probe/port.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { executableProbeStory, exitedProbe } from '../../../support/stories/executable-probe.js';

const definition = validateAgentDefinition(
  agentDefinition({
    launch: {
      command: '/installed/node',
      args: [],
      versionProbe: {
        command: '/installed/cli',
        args: ['--version'],
        prefix: 'cli ',
        stream: 'stdout',
        timeoutMs: 1_000,
      },
    },
  }),
).definition;

test('reports the selected CLI version separately from the adapter launcher', async () => {
  const story = executableProbeStory({ observation: exitedProbe('cli 7.8.9\n') });
  const preflight = createExecutablePreflight({
    ...story.port,
    resolveExecutable: async (command) => ({ executable: command, status: 'resolved' }),
  });

  const result = await preflight.probe(definition, new AbortController().signal);

  expect(result).toEqual({
    status: 'ready',
    launch: {
      executable: '/installed/node',
      versionProbeExecutable: '/installed/cli',
      reportedVersion: '7.8.9',
    },
  });
  expect(story.calls).toContainEqual({
    type: 'version',
    value: expect.objectContaining({ executable: '/installed/cli', environment: {} }),
  });
});

test.each([
  { resolution: { status: 'unavailable', reason: 'not_found' }, reason: 'executable_not_found' },
  {
    resolution: { status: 'unavailable', reason: 'not_launchable' },
    reason: 'executable_not_launchable',
  },
  {
    resolution: { status: 'resolved', executable: 'relative-cli' },
    reason: 'executable_not_launchable',
  },
] satisfies { resolution: ExecutableResolution; reason: string }[])(
  'rejects a selected CLI with $reason',
  async ({ resolution, reason }) => {
    const story = executableProbeStory();
    const preflight = createExecutablePreflight({
      ...story.port,
      resolveExecutable: async (command) =>
        command === '/installed/node' ? { executable: command, status: 'resolved' } : resolution,
    });
    await expect(preflight.probe(definition, new AbortController().signal)).resolves.toEqual({
      status: 'rejected',
      reason,
    });
    expect(story.calls).toEqual([]);
  },
);

test('bounds an unexpected error resolving the selected CLI', async () => {
  const story = executableProbeStory();
  const preflight = createExecutablePreflight({
    ...story.port,
    resolveExecutable: async (command) => {
      if (command === '/installed/cli') throw new Error('filesystem unavailable');
      return { executable: command, status: 'resolved' };
    },
  });
  await expect(preflight.probe(definition, new AbortController().signal)).resolves.toEqual({
    status: 'rejected',
    reason: 'executable_not_found',
  });
});

test('does not start a CLI version process after cancellation during resolution', async () => {
  const controller = new AbortController();
  const story = executableProbeStory();
  const preflight = createExecutablePreflight({
    ...story.port,
    resolveExecutable: async (command) => {
      if (command === '/installed/cli') controller.abort();
      return { executable: command, status: 'resolved' };
    },
  });
  await expect(preflight.probe(definition, controller.signal)).resolves.toEqual({
    status: 'aborted',
  });
  expect(story.calls).toEqual([]);
});
