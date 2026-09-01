import { expect, test } from 'vitest';

import type { AdjacentNodePackagePolicy } from '../../../../../src/discovery/platform.js';
import { resolveAdjacentNodePackage } from '../../../../../src/platform/node/discovery/adjacent-node-package.js';
import { adjacentNodePackage } from '../../../../support/builders/adjacent-node-package.js';

const cursorLayout: AdjacentNodePackagePolicy = Object.freeze({
  command: 'agent',
  entrypointName: 'index.js',
  launcherName: 'cursor-agent',
});

test('resolves only the adjacent Cursor Node and index layout', async () => {
  const fixture = await adjacentNodePackage();
  try {
    expect(resolveAdjacentNodePackage(cursorLayout, fixture.launcher, 'node')).toEqual({
      entrypoint: fixture.entrypoint,
      node: fixture.node,
    });
    expect(resolveAdjacentNodePackage(cursorLayout, fixture.directory, 'node')).toEqual({
      entrypoint: fixture.entrypoint,
      node: fixture.node,
    });
  } finally {
    await fixture.dispose();
  }
});

test.each(['collision', 'escaped_node', 'missing_index'] as const)(
  'rejects a %s launcher/package layout',
  async (mutation) => {
    const fixture = await adjacentNodePackage(mutation);
    try {
      expect(resolveAdjacentNodePackage(cursorLayout, fixture.launcher, 'node')).toBeUndefined();
    } finally {
      await fixture.dispose();
    }
  },
);

test('rejects unreadable files and missing candidates without treating them as a package', async () => {
  const fixture = await adjacentNodePackage();
  try {
    await import('node:fs/promises').then(({ chmod }) => chmod(fixture.launcher, 0o000));
    expect(resolveAdjacentNodePackage(cursorLayout, fixture.launcher, 'node')).toBeUndefined();
    expect(
      resolveAdjacentNodePackage(cursorLayout, '/missing/cursor-agent', 'node'),
    ).toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});
