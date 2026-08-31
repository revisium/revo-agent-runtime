import { expect, test } from 'vitest';

import { validateAgentDefinition } from '../../../../src/definition/index.js';
import { createExecutablePreflight } from '../../../../src/execution/probe/executable-preflight.js';
import type {} from '../../../../src/execution/probe/port.js';
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
test('freshly resolves and proves the exact executable with strict immutable launch evidence', async () => {
  const story = executableProbeStory({ observation: exitedProbe('agent 1.2.3\r\n') });

  const result = await probe(story, {
    launch: {
      args: [],
      command: 'agent',
      versionProbe: { args: ['version'], prefix: 'agent ', stream: 'stdout', timeoutMs: 2_000 },
    },
  });

  expect(result).toEqual({
    launch: { executable: '/resolved/agent', reportedVersion: '1.2.3' },
    status: 'ready',
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(story.calls).toEqual([
    { type: 'resolve', value: 'agent' },
    {
      type: 'version',
      value: {
        args: ['version'],
        environment: {},
        executable: '/resolved/agent',
        shell: false,
        stderrLimitBytes: 65_536,
        stdoutLimitBytes: 65_536,
        timeoutMs: 2_000,
      },
    },
  ]);
});

test.each([
  ['build identity', 'grok 1.0.13 (5e9a58528b76)\n'],
  ['build identity and release channel', 'grok 1.0.13 (5e9a58528b76) [stable]\n'],
] as const)('preserves opaque Grok %s after its exact prefix', async (_name, output) => {
  const story = executableProbeStory({ observation: exitedProbe(output) });

  await expect(
    probe(story, {
      launch: {
        args: [],
        command: 'grok',
        versionProbe: { args: ['--version'], prefix: 'grok ', stream: 'stdout', timeoutMs: 1_000 },
      },
    }),
  ).resolves.toMatchObject({
    launch: { executable: '/resolved/agent', reportedVersion: output.trim().slice('grok '.length) },
    status: 'ready',
  });
});

test.each([
  ['invalid UTF-8', new Uint8Array([0xff]), 'invalid_utf8'],
  ['multiple lines', '1.0.0\nextra', 'line_break'],
  ['surrounding whitespace', ' 1.0.0', 'surrounding_whitespace'],
  ['NUL', '1.0.0\0', 'nul'],
  ['empty output', '', 'empty_version'],
  ['unicode line separator', '1.0.0\u2028', 'line_break'],
  ['control character evidence', '1.0.0\t', 'control_character'],
  ['delete control character evidence', '1.0.0\u007f', 'control_character'],
] as const)('rejects %s version output', async (_name, output, outputReason) => {
  const result = await probe(executableProbeStory({ observation: exitedProbe(output) }));
  expect(result).toEqual({ outputReason, reason: 'probe_output_invalid', status: 'rejected' });
});

test.each([
  ['Node', 'v24.18.0\n', undefined, 'v24.18.0'],
  [
    'Copilot',
    'GitHub Copilot CLI 1.0.82.\nA new version is available.\n',
    'GitHub Copilot CLI ',
    '1.0.82.',
  ],
  ['Cursor', '2026.08.11-e8db854\n', undefined, '2026.08.11-e8db854'],
  ['Goose', ' 1.48.0\n', ' ', '1.48.0'],
  [
    'Antigravity',
    'ACP server ready\nBuild label: agy_acp_server_20260818_01_RC01\n',
    'Build label: ',
    'agy_acp_server_20260818_01_RC01',
  ],
] as const)(
  'selects opaque %s version evidence',
  async (_provider, output, prefix, reportedVersion) => {
    await expect(
      probe(executableProbeStory({ observation: exitedProbe(output) }), {
        launch: {
          args: [],
          command: 'agent',
          versionProbe: {
            args: ['--version'],
            ...(prefix === undefined ? {} : { prefix }),
            stream: 'stdout',
            timeoutMs: 1_000,
          },
        },
      }),
    ).resolves.toMatchObject({ launch: { reportedVersion }, status: 'ready' });
  },
);

test.each([
  ['no matching prefix', 'Build: 1.0.0\n', 'Build label: ', 'prefix_mismatch'],
  [
    'ambiguous matching lines',
    'Build label: first\nBuild label: second\n',
    'Build label: ',
    'ambiguous_version',
  ],
  ['empty prefixed evidence', 'Build label: \n', 'Build label: ', 'empty_version'],
  [
    'whitespace inside prefixed evidence',
    'Build label: 1.0.0 \n',
    'Build label: ',
    'surrounding_whitespace',
  ],
  [
    'control character inside prefixed evidence',
    'Build label: 1.0.0\t\n',
    'Build label: ',
    'control_character',
  ],
] as const)(
  'rejects %s in prefixed version output',
  async (_name, output, prefix, outputReason) => {
    await expect(
      probe(executableProbeStory({ observation: exitedProbe(output) }), {
        launch: {
          args: [],
          command: 'agent',
          versionProbe: { args: ['--version'], prefix, stream: 'stdout', timeoutMs: 1_000 },
        },
      }),
    ).resolves.toEqual({ outputReason, reason: 'probe_output_invalid', status: 'rejected' });
  },
);

test('uses only the selected stderr stream and enforces the exact prefix', async () => {
  const story = executableProbeStory({
    observation: exitedProbe('tool 2.0.0\n', { stream: 'stderr' }),
  });
  await expect(
    probe(story, {
      launch: {
        args: [],
        command: 'agent',
        versionProbe: { args: ['--version'], prefix: 'tool ', stream: 'stderr', timeoutMs: 1_000 },
      },
    }),
  ).resolves.toMatchObject({ launch: { reportedVersion: '2.0.0' }, status: 'ready' });

  const mismatch = executableProbeStory({
    observation: exitedProbe('Tool 2.0.0', { stream: 'stderr' }),
  });
  await expect(
    probe(mismatch, {
      launch: {
        args: [],
        command: 'agent',
        versionProbe: { args: ['--version'], prefix: 'tool ', stream: 'stderr', timeoutMs: 1_000 },
      },
    }),
  ).resolves.toEqual({
    outputReason: 'prefix_mismatch',
    reason: 'probe_output_invalid',
    status: 'rejected',
  });
});

test.each([
  ['missing executable', { status: 'unavailable', reason: 'not_found' }, 'executable_not_found'],
  [
    'non-launchable executable',
    { status: 'unavailable', reason: 'not_launchable' },
    'executable_not_launchable',
  ],
] as const)('rejects a %s before the version process starts', async (_name, resolution, reason) => {
  const story = executableProbeStory({ resolution });
  await expect(probe(story)).resolves.toEqual({ reason, status: 'rejected' });
  expect(story.calls.map((call) => call.type)).toEqual(['resolve']);
});

test('rejects unsupported host cells before resolution', async () => {
  const story = executableProbeStory({ platform: 'darwin' });
  await expect(probe(story, { constraints: { platforms: ['linux'] } })).resolves.toEqual({
    reason: 'platform_unsupported',
    status: 'rejected',
  });
  expect(story.calls).toEqual([]);
});
