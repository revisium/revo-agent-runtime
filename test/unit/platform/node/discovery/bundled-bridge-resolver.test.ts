import { realpath } from 'node:fs/promises';

import { describe, expect, test } from 'vitest';

import type { BridgePackagePolicy } from '../../../../../src/discovery/platform.js';
import { resolveBundledBridge } from '../../../../../src/platform/node/discovery/bundled-bridge.js';
import { claudeProviderPolicy } from '../../../../../src/providers/claude/definition.js';
import { codexProviderPolicy } from '../../../../../src/providers/codex/definition.js';
import { bridgePackage } from '../../../../support/builders/bridge-package.js';

const genericFixturePolicy = (policy: BridgePackagePolicy, name: string): BridgePackagePolicy => ({
  ...policy,
  bridgeName: `@revo-test/${name}-bridge`,
  vendorName: `@revo-test/${name}-vendor`,
});

const bridges = [
  { name: 'codex', policy: genericFixturePolicy(codexProviderPolicy.bridge, 'codex') },
  { name: 'claude', policy: genericFixturePolicy(claudeProviderPolicy.bridge, 'claude') },
] as const;

const availableBridge = async (
  policy: BridgePackagePolicy,
  vendor: 'hoisted' | 'nested',
): Promise<void> => {
  const fixture = await bridgePackage(policy, { vendor });
  try {
    expect(resolveBundledBridge(policy, fixture.anchor)).toEqual({
      available: true,
      entrypoint: await realpath(fixture.expectedEntrypoint),
    });
  } finally {
    await fixture.dispose();
  }
};

describe.each(bridges)('bundled $name bridge', ({ policy }) => {
  test.each(['nested', 'hoisted'] as const)(
    'resolves its exact entrypoint with a %s vendor package',
    async (vendor) => availableBridge(policy, vendor),
  );

  test('resolves a vendor whose package manifest is not exported', async () => {
    const fixture = await bridgePackage(policy, { vendor: 'unexported' });
    try {
      expect(resolveBundledBridge(policy, fixture.anchor)).toMatchObject({ available: true });
    } finally {
      await fixture.dispose();
    }
  });

  test.each([
    ['missing manifest', { manifest: 'missing' }, 'package_unavailable'],
    ['tampered manifest', { manifest: 'invalid' }, 'package_unavailable'],
    ['manifest realpath escape', { manifest: 'escape' }, 'manifest_invalid'],
    [
      'different package identity',
      { bridgeName: '@agentclientprotocol/wrong' },
      'manifest_invalid',
    ],
    ['different bridge version', { bridgeVersion: '99.0.0' }, 'version_mismatch'],
    ['missing bin declaration', { bin: {} }, 'bin_invalid'],
    ['changed bin declaration', { bin: { wrong: 'dist/index.js' } }, 'bin_invalid'],
    ['string bin declaration', { bin: 'dist/index.js' }, 'bin_invalid'],
    ['changed vendor range', { dependencyRange: 'latest' }, 'vendor_dependency_invalid'],
    ['missing vendor package', { vendor: 'missing' }, 'vendor_dependency_invalid'],
    ['different vendor version', { vendor: 'mismatched' }, 'vendor_dependency_invalid'],
    ['unidentifiable vendor package', { vendor: 'unidentifiable' }, 'vendor_dependency_invalid'],
    ['missing entrypoint', { entry: 'missing' }, 'entrypoint_invalid'],
    ['directory entrypoint', { entry: 'directory' }, 'entrypoint_invalid'],
    ['entrypoint realpath escape', { entry: 'escape' }, 'entrypoint_invalid'],
  ] as const)('rejects a %s', async (_name, mutation, reason) => {
    const fixture = await bridgePackage(policy, mutation);
    try {
      expect(resolveBundledBridge(policy, fixture.anchor)).toEqual({ available: false, reason });
    } finally {
      await fixture.dispose();
    }
  });
});

test('keeps a missing generic bridge fixture unavailable below an ancestor bridge installation', async () => {
  const policy = genericFixturePolicy(codexProviderPolicy.bridge, 'isolated-negative');
  const fixture = await bridgePackage(policy, {
    ancestorPackage: codexProviderPolicy.bridge,
    manifest: 'missing',
  });
  try {
    expect(resolveBundledBridge(policy, fixture.anchor)).toEqual({
      available: false,
      reason: 'package_unavailable',
    });
  } finally {
    await fixture.dispose();
  }
});
