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
const bundledProvidersOnly = Object.freeze({
  disabledDetectorIds: systemProviderIds,
}) satisfies DiscoverAgentsOptions;
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
test('uses a validated absolute bridge override without lookup, probe duplication, or bundle fallback', async () => {
  const options: DiscoverAgentsOptions = {
    ...bundledProvidersOnly,
    systemExecutableOverrides: { codex: '/selected/codex-acp' },
  };
  const { calls, result } = await discoverWith(options, {
    overrideExecutable: '/system/codex-acp',
  });

  expect(calls).toEqual(['bundle:claude', 'override:/selected/codex-acp:active']);
  expect(result.definitions.map(({ id }) => id)).toEqual(['claude-acp', 'codex-acp']);
  expect(result.definitions[1]?.launch).toMatchObject({
    command: '/system/codex-acp',
    args: [],
    versionProbe: { prefix: '@agentclientprotocol/codex-acp ' },
  });
});

test('probes the selected Node executable for both exact bundled bridges', async () => {
  const { result } = await discoverWith(bundledProvidersOnly);

  expect(result.definitions).toHaveLength(2);
  for (const definition of result.definitions) {
    expect(definition.launch).toMatchObject({
      command: process.execPath,
      versionProbe: { args: ['--version'], prefix: 'v', stream: 'stdout' },
    });
  }
});

test('uses the prefix-free Claude bridge version format for an explicit override', async () => {
  const { result } = await discoverWith(
    {
      ...bundledProvidersOnly,
      systemExecutableOverrides: { claude: '/selected/claude-agent-acp' },
    },
    { overrideExecutable: '/system/claude-agent-acp' },
  );

  const claude = result.definitions.find(({ id }) => id === 'claude-acp');
  expect(claude?.launch.versionProbe).toEqual({
    args: ['--version'],
    stream: 'stdout',
    timeoutMs: 1_000,
  });
});

test('reports an invalid explicit override and never falls back to a bundled bridge', async () => {
  const options: DiscoverAgentsOptions = {
    ...bundledProvidersOnly,
    systemExecutableOverrides: { codex: 'relative-codex-acp' },
  };
  const { calls, result } = await discoverWith(options);

  expect(calls).toEqual(['bundle:claude', 'override:relative-codex-acp:active']);
  expect(result.definitions.map(({ id }) => id)).toEqual(['claude-acp']);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'system_override_unavailable', detectorId: 'codex' }),
  );
});

test('isolates an unavailable exact bundle with a bounded provider diagnostic', async () => {
  const { result } = await discoverWith(bundledProvidersOnly, { bundledUnavailable: 'claude' });

  expect(result.definitions.map(({ id }) => id)).toEqual(['codex-acp']);
  expect(result.diagnostics).toContainEqual({
    code: 'bundled_bridge_unavailable',
    detectorId: 'claude',
    message: 'The exact bundled ACP bridge is unavailable.',
    severity: 'error',
  });
});
