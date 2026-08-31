import { expect, test } from 'vitest';

import type { DiscoverAgentsOptions } from '../../../../src/contracts/discovery.js';
import type { NodePackageEntrypointPolicy } from '../../../../src/discovery/platform.js';
import type { DiscoveryPlatform } from '../../../../src/discovery/platform.js';
import { runDetectors } from '../../../../src/discovery/runner.js';
import { builtInDetectors } from '../../../../src/providers/index.js';

const providerIds = Object.freeze([
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
] as const);
const npmProviderIds = Object.freeze(['copilot', 'kilo', 'qwen', 'kimi'] as const);
type NpmProviderId = (typeof npmProviderIds)[number];

const npmProviderIdSet: ReadonlySet<string> = new Set(npmProviderIds);
const isNpmProviderId = (candidate: string): candidate is NpmProviderId =>
  npmProviderIdSet.has(candidate);

const only = (provider: (typeof providerIds)[number]): DiscoverAgentsOptions => ({
  disabledDetectorIds: providerIds.filter((id) => id !== provider),
});

const platform = (
  entrypoints: Readonly<Partial<Record<NpmProviderId, string>>> = {},
): { readonly calls: string[]; readonly value: DiscoveryPlatform } => {
  const calls: string[] = [];
  return {
    calls,
    value: {
      probeSystemExecutable: async () => true,
      resolveAdjacentNodePackage: async () => undefined,
      resolveBundledBridge: () => ({ available: false, reason: 'package_unavailable' }),
      resolveNodePackageEntrypoint: async (
        policy: NodePackageEntrypointPolicy,
        override: string | undefined,
      ) => {
        calls.push(`node:${policy.command}:${override ?? 'default'}`);
        return isNpmProviderId(policy.command) ? entrypoints[policy.command] : undefined;
      },
      resolveSystemExecutable: async (command) =>
        command === 'cline' ? '/system/cline' : undefined,
      resolveSystemOverride: async (executable) =>
        executable === '/selected/cline' ? executable : undefined,
    },
  };
};

const discover = async (
  options: DiscoverAgentsOptions,
  entrypoints: Readonly<Partial<Record<NpmProviderId, string>>> = {},
) => {
  const recorded = platform(entrypoints);
  return {
    calls: recorded.calls,
    result: await runDetectors(builtInDetectors(options, recorded.value), options),
  };
};

test.each([
  ['copilot', '--acp', '--stdio', 'GitHub Copilot CLI ', 5_000],
  ['kilo', 'acp', undefined, undefined, 5_000],
  ['qwen', '--acp', undefined, undefined, 1_000],
  ['kimi', 'acp', undefined, undefined, 5_000],
] as const)(
  'discovers %s through an absolute Node entrypoint',
  async (provider, firstArg, secondArg, prefix, timeoutMs) => {
    const entrypoint = `/packages/${provider}/entrypoint.js`;
    const { result } = await discover(only(provider), { [provider]: entrypoint });

    expect(result.definitions).toEqual([
      expect.objectContaining({
        id: `${provider}-acp`,
        launch: {
          command: process.execPath,
          args: [
            { kind: 'literal', value: entrypoint },
            { kind: 'literal', value: firstArg },
            ...(secondArg === undefined ? [] : [{ kind: 'literal', value: secondArg }]),
          ],
          versionProbe: {
            args: [entrypoint, '--version'],
            ...(prefix === undefined ? {} : { prefix }),
            stream: 'stdout',
            timeoutMs,
          },
        },
      }),
    ]);
  },
);

test('uses Cline as a direct native ACP executable', async () => {
  const { result } = await discover(only('cline'));
  expect(result.definitions).toEqual([
    expect.objectContaining({
      id: 'cline-acp',
      launch: {
        args: [{ kind: 'literal', value: '--acp' }],
        command: '/system/cline',
        versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 5_000 },
      },
    }),
  ]);
});

test('uses a selected Node entrypoint without fallback and isolates an unavailable override', async () => {
  const selected = '/selected/kilo.js';
  const success = await discover(
    { ...only('kilo'), systemExecutableOverrides: { kilo: selected } },
    { kilo: '/canonical/kilo.js' },
  );
  expect(success.calls).toEqual(['node:kilo:/selected/kilo.js']);
  expect(success.result.definitions[0]?.launch.command).toBe(process.execPath);

  const unavailable = await discover({
    ...only('kilo'),
    systemExecutableOverrides: { kilo: selected },
  });
  expect(unavailable.calls).toEqual(['node:kilo:/selected/kilo.js']);
  expect(unavailable.result.definitions).toEqual([]);
  expect(unavailable.result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'system_override_unavailable', detectorId: 'kilo' }),
  );
});

test('does not resolve disabled npm detectors and preserves deterministic built-in order', async () => {
  const disabled = await discover({ ...only('cline'), disabledDetectorIds: [...providerIds] });
  expect(disabled.calls).toEqual([]);

  const enabled = await discover(
    { disabledDetectorIds: ['claude', 'gemini', 'grok', 'opencode'] },
    {
      copilot: '/packages/copilot/entrypoint.js',
      kilo: '/packages/kilo/entrypoint.js',
      kimi: '/packages/kimi/entrypoint.js',
      qwen: '/packages/qwen/entrypoint.js',
    },
  );
  expect(enabled.result.definitions.map(({ id }) => id)).toEqual([
    'cline-acp',
    'copilot-acp',
    'kilo-acp',
    'kimi-acp',
    'qwen-acp',
  ]);
});
