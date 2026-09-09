import * as filesystem from 'node:fs';
import { basename } from 'node:path';

import { expect, test, vi } from 'vitest';

import type { AdjacentNodePackagePolicy } from '../../../../../src/discovery/platform.js';
import { resolveAdjacentNodePackage } from '../../../../../src/platform/node/discovery/adjacent-node-package.js';
import { adjacentNodePackage } from '../../../../support/builders/adjacent-node-package.js';

vi.mock('node:fs', { spy: true });

const cursorLayout: AdjacentNodePackagePolicy = Object.freeze({
  command: 'agent',
  entrypointName: 'index.js',
  launcherName: 'cursor-agent',
});

test('resolves only the adjacent Cursor Node and index layout', async () => {
  const fixture = await adjacentNodePackage();
  try {
    expect(
      resolveAdjacentNodePackage(cursorLayout, fixture.launcher, basename(fixture.node)),
    ).toEqual({
      entrypoint: fixture.entrypoint,
      node: fixture.node,
    });
    expect(
      resolveAdjacentNodePackage(cursorLayout, fixture.directory, basename(fixture.node)),
    ).toEqual({
      entrypoint: fixture.entrypoint,
      node: fixture.node,
    });
  } finally {
    vi.restoreAllMocks();
    await fixture.dispose();
  }
});

test.each(['collision', 'escaped_node', 'missing_index'] as const)(
  'rejects a %s launcher/package layout',
  async (mutation) => {
    const fixture = await adjacentNodePackage(mutation);
    try {
      expect(
        resolveAdjacentNodePackage(cursorLayout, fixture.launcher, basename(fixture.node)),
      ).toBeUndefined();
    } finally {
      await fixture.dispose();
    }
  },
);

test('rejects unreadable files and missing candidates without treating them as a package', async () => {
  const fixture = await adjacentNodePackage();
  try {
    const access = filesystem.accessSync;
    vi.spyOn(filesystem, 'accessSync').mockImplementation((path, mode) => {
      if (path === fixture.launcher)
        throw Object.assign(new Error('Read denied'), { code: 'EACCES' });
      access(path, mode);
    });
    expect(
      resolveAdjacentNodePackage(cursorLayout, fixture.launcher, basename(fixture.node)),
    ).toBeUndefined();
    expect(
      resolveAdjacentNodePackage(cursorLayout, '/missing/cursor-agent', 'node'),
    ).toBeUndefined();
  } finally {
    vi.restoreAllMocks();
    await fixture.dispose();
  }
});
