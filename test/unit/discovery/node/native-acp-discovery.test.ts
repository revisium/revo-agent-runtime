import { expect, test } from 'vitest';

import type { DiscoverAgentsOptions } from '../../../../src/contracts/discovery.js';
import type { AdjacentNodePackagePolicy } from '../../../../src/discovery/platform.js';
import type { NodePackageEntrypointPolicy } from '../../../../src/discovery/platform.js';
import type {
  DiscoveryPlatform,
  SystemExecutableProbe,
} from '../../../../src/discovery/platform.js';
import { runDetectors } from '../../../../src/discovery/runner.js';
import { builtInDetectors } from '../../../../src/providers/index.js';

const providerIds = Object.freeze([
  'antigravity',
  'claude',
  'cline',
  'codex',
  'copilot',
  'cursor',
  'gemini',
  'goose',
  'grok',
  'hermes',
  'kilo',
  'kimi',
  'opencode',
  'qwen',
  'vibe',
] as const);

const only = (provider: (typeof providerIds)[number]): DiscoverAgentsOptions => ({
  disabledDetectorIds: providerIds.filter((id) => id !== provider),
});

const directExecutables: Readonly<Record<string, string>> = Object.freeze({
  'agy_acp_server.par': '/system/agy_acp_server.par',
  goose: '/system/goose',
  hermes: '/system/hermes',
  'vibe-acp': '/system/vibe-acp',
});

const platform = (): { readonly calls: string[]; readonly value: DiscoveryPlatform } => {
  const calls: string[] = [];
  return {
    calls,
    value: {
      probeSystemExecutable: async (executable: string, probe: SystemExecutableProbe) => {
        calls.push(`probe:${executable}:${probe.args.join(' ')}:${probe.timeoutMs}`);
        return true;
      },
      resolveAdjacentNodePackage: async (
        policy: AdjacentNodePackagePolicy,
        override: string | undefined,
      ) => {
        calls.push(`adjacent:${policy.command}:${override ?? 'default'}`);
        return override === '/selected/cursor-agent'
          ? { entrypoint: '/selected/index.js', node: '/selected/node' }
          : override === undefined && policy.command === 'agent'
            ? { entrypoint: '/cursor/index.js', node: '/cursor/node' }
            : undefined;
      },
      resolveBundledBridge: () => ({ available: false, reason: 'package_unavailable' }),
      resolveNodePackageEntrypoint: async (
        _policy: NodePackageEntrypointPolicy,
        _override: string | undefined,
      ) => undefined,
      resolveSystemExecutable: async (command) => directExecutables[command],
      resolveSystemOverride: async (executable: string, probe: SystemExecutableProbe) => {
        calls.push(`override:${executable}:${probe.args.join(' ')}:${probe.timeoutMs}`);
        return executable.startsWith('/selected/') ? executable : undefined;
      },
    },
  };
};

const discover = async (options: DiscoverAgentsOptions) => {
  const recorded = platform();
  return {
    calls: recorded.calls,
    result: await runDetectors(builtInDetectors(options, recorded.value), options),
  };
};

test.each([
  ['vibe', '/system/vibe-acp', [], ['--version'], undefined, 5_000],
  ['hermes', '/system/hermes', ['acp'], ['acp', '--version'], undefined, 3_000],
  ['goose', '/system/goose', ['acp'], ['--version'], ' ', 1_000],
  ['antigravity', '/system/agy_acp_server.par', ['--uid='], ['--version'], 'Build label: ', 20_000],
] as const)(
  'discovers %s with its provider-owned ACP and version arguments',
  async (provider, command, args, versionArgs, prefix, timeoutMs) => {
    const { calls, result } = await discover(only(provider));

    expect(calls).toEqual([`probe:${command}:${versionArgs.join(' ')}:${timeoutMs}`]);
    expect(result.definitions).toEqual([
      expect.objectContaining({
        id: `${provider}-acp`,
        launch: {
          args: args.map((value) => ({ kind: 'literal', value })),
          command,
          versionProbe: {
            args: versionArgs,
            ...(prefix === undefined ? {} : { prefix }),
            stream: 'stdout',
            timeoutMs,
          },
        },
      }),
    ]);
  },
);

test('uses the validated Cursor adjacent package without accepting a Grok agent collision', async () => {
  const defaultCursor = await discover(only('cursor'));
  expect(defaultCursor.calls).toEqual(['adjacent:agent:default']);
  expect(defaultCursor.result.definitions).toEqual([
    expect.objectContaining({
      id: 'cursor-acp',
      launch: {
        args: [
          { kind: 'literal', value: '/cursor/index.js' },
          { kind: 'literal', value: 'acp' },
        ],
        command: '/cursor/node',
        versionProbe: {
          args: ['/cursor/index.js', '--version'],
          stream: 'stdout',
          timeoutMs: 5_000,
        },
      },
    }),
  ]);

  const selected = await discover({
    ...only('cursor'),
    systemExecutableOverrides: { cursor: '/selected/cursor-agent' },
  });
  expect(selected.calls).toEqual(['adjacent:agent:/selected/cursor-agent']);
  expect(selected.result.definitions[0]?.launch.command).toBe('/selected/node');

  const unavailable = await discover({
    ...only('cursor'),
    systemExecutableOverrides: { cursor: '/system/grok-agent' },
  });
  expect(unavailable.calls).toEqual(['adjacent:agent:/system/grok-agent']);
  expect(unavailable.result.definitions).toEqual([]);
  expect(unavailable.result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'system_override_unavailable', detectorId: 'cursor' }),
  );
});

test('isolates disabled native detectors and keeps the expanded built-in order deterministic', async () => {
  const disabled = await discover({ disabledDetectorIds: [...providerIds] });
  expect(disabled.calls).toEqual([]);

  const enabled = await discover({
    disabledDetectorIds: [
      'claude',
      'cline',
      'codex',
      'copilot',
      'gemini',
      'grok',
      'kilo',
      'kimi',
      'opencode',
      'qwen',
    ],
  });
  expect(enabled.result.definitions.map(({ id }) => id)).toEqual([
    'antigravity-acp',
    'cursor-acp',
    'goose-acp',
    'hermes-acp',
    'vibe-acp',
  ]);
});
