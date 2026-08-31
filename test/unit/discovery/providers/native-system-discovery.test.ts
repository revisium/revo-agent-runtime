import { expect, test } from 'vitest';

import type { DiscoverAgentsOptions } from '../../../../src/contracts/discovery.js';
import type { BridgePackagePolicy } from '../../../../src/discovery/platform.js';
import type { DiscoveryPlatform } from '../../../../src/discovery/platform.js';
import { runDetectors } from '../../../../src/discovery/runner.js';
import { builtInDetectors } from '../../../../src/providers/index.js';

interface PlatformBehavior {
  readonly bundledUnavailable?: 'claude' | 'codex';
  readonly overrideExecutable?: string;
  readonly probeAvailable?: boolean;
  readonly systemExecutables?: Readonly<Partial<Record<'gemini' | 'grok' | 'opencode', string>>>;
}

const systemProviderIds = Object.freeze([
  'antigravity',
  'cline',
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
const onlySystemProvider = (selected: (typeof systemProviderIds)[number]): DiscoverAgentsOptions =>
  Object.freeze({
    disabledDetectorIds: Object.freeze(systemProviderIds.filter((id) => id !== selected)),
  });
const geminiProviderOnly = onlySystemProvider('gemini');

const recordingPlatform = (
  behavior: PlatformBehavior = {},
): { readonly calls: string[]; readonly platform: DiscoveryPlatform } => {
  const calls: string[] = [];
  return {
    calls,
    platform: {
      probeSystemExecutable: async (executable, _probe, signal) => {
        calls.push(`probe:${executable}:${signal?.aborted === true ? 'aborted' : 'active'}`);
        return behavior.probeAvailable ?? true;
      },
      resolveBundledBridge: (policy: BridgePackagePolicy) => {
        const provider =
          policy.bridgeName === '@agentclientprotocol/codex-acp' ? 'codex' : 'claude';
        calls.push(`bundle:${provider}`);
        return behavior.bundledUnavailable === provider
          ? { available: false, reason: 'version_mismatch' }
          : { available: true, entrypoint: `/bundled/${provider}.mjs` };
      },
      resolveNodePackageEntrypoint: async () => undefined,
      resolveAdjacentNodePackage: async () => undefined,
      resolveSystemExecutable: async (command) => {
        calls.push(`which:${command}`);
        return command === 'gemini' || command === 'grok' || command === 'opencode'
          ? behavior.systemExecutables?.[command]
          : undefined;
      },
      resolveSystemOverride: async (executable, _probe, signal) => {
        calls.push(`override:${executable}:${signal?.aborted === true ? 'aborted' : 'active'}`);
        return behavior.overrideExecutable;
      },
    },
  };
};

const discoverWith = async (options: DiscoverAgentsOptions, behavior: PlatformBehavior = {}) => {
  const recorded = recordingPlatform(behavior);
  const result = await runDetectors(builtInDetectors(options, recorded.platform), options);
  return { ...recorded, result };
};
test('discovers a selected Gemini CLI through its native ACP mode', async () => {
  const { calls, result } = await discoverWith(
    {
      ...geminiProviderOnly,
      systemExecutableOverrides: { gemini: '/selected/gemini' },
    },
    { overrideExecutable: '/system/selected-gemini' },
  );

  expect(calls).toEqual(['bundle:claude', 'bundle:codex', 'override:/selected/gemini:active']);
  expect(result.definitions.map(({ id }) => id)).toEqual(['claude-acp', 'codex-acp', 'gemini-acp']);
  expect(result.definitions[2]).toMatchObject({
    id: 'gemini-acp',
    launch: {
      args: [{ kind: 'literal', value: '--acp' }],
      command: '/system/selected-gemini',
      versionProbe: { args: ['--version'] },
    },
  });
});

test('discovers the default Gemini CLI without starting an ACP session', async () => {
  const { calls, result } = await discoverWith(geminiProviderOnly, {
    systemExecutables: { gemini: '/system/gemini' },
  });

  expect(calls).toEqual([
    'bundle:claude',
    'bundle:codex',
    'which:gemini',
    'probe:/system/gemini:active',
  ]);
  expect(result.definitions[2]).toMatchObject({
    id: 'gemini-acp',
    launch: { args: [{ kind: 'literal', value: '--acp' }], command: '/system/gemini' },
  });
});

test('discovers a selected OpenCode CLI through its native ACP command', async () => {
  const { calls, result } = await discoverWith(
    {
      ...onlySystemProvider('opencode'),
      systemExecutableOverrides: { opencode: '/selected/opencode' },
    },
    { overrideExecutable: '/system/selected-opencode' },
  );

  expect(calls).toEqual(['bundle:claude', 'bundle:codex', 'override:/selected/opencode:active']);
  expect(result.definitions.map(({ id }) => id)).toEqual([
    'claude-acp',
    'codex-acp',
    'opencode-acp',
  ]);
  expect(result.definitions[2]).toMatchObject({
    id: 'opencode-acp',
    launch: {
      args: [{ kind: 'literal', value: 'acp' }],
      command: '/system/selected-opencode',
      versionProbe: { args: ['--version'], timeoutMs: 3_000 },
    },
  });
});

test('discovers the default OpenCode CLI without starting an ACP session', async () => {
  const { calls, result } = await discoverWith(onlySystemProvider('opencode'), {
    systemExecutables: { opencode: '/system/opencode' },
  });

  expect(calls).toEqual([
    'bundle:claude',
    'bundle:codex',
    'which:opencode',
    'probe:/system/opencode:active',
  ]);
  expect(result.definitions[2]).toMatchObject({
    id: 'opencode-acp',
    launch: { args: [{ kind: 'literal', value: 'acp' }], command: '/system/opencode' },
  });
});
