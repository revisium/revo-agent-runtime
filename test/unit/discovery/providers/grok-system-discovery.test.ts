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
const onlySystemProvider = (selected: (typeof systemProviderIds)[number]): DiscoverAgentsOptions =>
  Object.freeze({
    disabledDetectorIds: Object.freeze(systemProviderIds.filter((id) => id !== selected)),
  });
const grokProviderOnly = onlySystemProvider('grok');

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
test('discovers the default system Grok ACP executable without starting its ACP command', async () => {
  const controller = new AbortController();
  const { calls, result } = await discoverWith(
    { ...grokProviderOnly, signal: controller.signal },
    { systemExecutables: { grok: '/system/grok' } },
  );

  expect(calls).toEqual([
    'bundle:claude',
    'bundle:codex',
    'which:grok',
    'probe:/system/grok:active',
  ]);
  expect(result.definitions.map(({ id }) => id)).toEqual(['claude-acp', 'codex-acp', 'grok-acp']);
  expect(result.definitions[2]).toMatchObject({
    id: 'grok-acp',
    launch: {
      args: [
        { kind: 'literal', value: 'agent' },
        { kind: 'literal', value: 'stdio' },
      ],
      command: '/system/grok',
      versionProbe: { args: ['--version'], prefix: 'grok ' },
    },
  });
});

test('uses a selected Grok override without PATH lookup, duplicate probe, or bundle fallback', async () => {
  const options: DiscoverAgentsOptions = {
    ...grokProviderOnly,
    systemExecutableOverrides: { grok: '/selected/grok' },
  };
  const { calls, result } = await discoverWith(options, {
    overrideExecutable: '/system/selected-grok',
  });

  expect(calls).toEqual(['bundle:claude', 'bundle:codex', 'override:/selected/grok:active']);
  expect(result.definitions[2]?.launch.command).toBe('/system/selected-grok');
});

test('rejects an unavailable selected Grok override without a bundled fallback', async () => {
  const options: DiscoverAgentsOptions = {
    ...grokProviderOnly,
    systemExecutableOverrides: { grok: '/selected/grok' },
  };
  const { result } = await discoverWith(options);

  expect(result.definitions.map(({ id }) => id)).toEqual(['claude-acp', 'codex-acp']);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'system_override_unavailable', detectorId: 'grok' }),
  );
});

test('isolates a missing default Grok executable without a probe or model observation', async () => {
  const { calls, result } = await discoverWith(grokProviderOnly);

  expect(calls).toEqual(['bundle:claude', 'bundle:codex', 'which:grok']);
  expect(result.definitions.map(({ id }) => id)).toEqual(['claude-acp', 'codex-acp']);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'system_executable_unavailable',
      detectorId: 'grok',
      severity: 'warning',
    }),
  );
  expect(result.modelObservations).not.toContainEqual(
    expect.objectContaining({ detectorId: 'grok' }),
  );
});

test('isolates a default Grok executable that fails its version probe', async () => {
  const { calls, result } = await discoverWith(grokProviderOnly, {
    probeAvailable: false,
    systemExecutables: { grok: '/system/grok' },
  });

  expect(calls).toEqual([
    'bundle:claude',
    'bundle:codex',
    'which:grok',
    'probe:/system/grok:active',
  ]);
  expect(result.definitions.map(({ id }) => id)).toEqual(['claude-acp', 'codex-acp']);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'system_executable_unavailable', detectorId: 'grok' }),
  );
});

test('does not resolve, probe, or bundle a disabled Grok detector', async () => {
  const { calls, result } = await discoverWith(bundledProvidersOnly);

  expect(calls).toEqual(['bundle:claude', 'bundle:codex']);
  expect(result.definitions.map(({ id }) => id)).toEqual(['claude-acp', 'codex-acp']);
});
