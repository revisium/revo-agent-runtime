import { expect, test } from 'vitest';

import type { NodePackageEntrypointPolicy } from '../../../../../src/discovery/platform.js';
import { resolveNodePackageEntrypoint } from '../../../../../src/platform/node/discovery/node-entrypoint.js';
import { nodePackageEntrypoint } from '../../../../support/builders/node-package-entrypoint.js';

const policy: NodePackageEntrypointPolicy = Object.freeze({
  binName: 'agent',
  command: 'agent',
  packageName: '@fixture/agent',
});

test('canonicalizes the declared Node package entrypoint from a wrapper path', async () => {
  const fixture = await nodePackageEntrypoint(policy);
  try {
    expect(resolveNodePackageEntrypoint(policy, fixture.packageBin)).toBe(fixture.entrypoint);
  } finally {
    await fixture.dispose();
  }
});

test.each([
  'absolute_bin',
  'different_bin',
  'directory',
  'escape',
  'manifest_array',
  'missing',
  'missing_bin',
  'missing_declared_bin',
  'no_shebang',
  'number_bin',
] as const)('rejects a %s Node package entrypoint', async (mutation) => {
  const fixture = await nodePackageEntrypoint(policy, mutation);
  try {
    expect(resolveNodePackageEntrypoint(policy, fixture.packageBin)).toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});
