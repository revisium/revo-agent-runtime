import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { resolveBundledBridge } from '../../../../../src/platform/node/discovery/bundled-bridge.js';
import { codexProviderPolicy } from '../../../../../src/providers/codex/definition.js';
import { withTemporaryDirectory } from '../../../../support/assertions/temporary-directory.js';

const policy = codexProviderPolicy.bridge;

test('resolves the packaged JavaScript adapter without a vendor package', async () => {
  await withTemporaryDirectory(async (directory) => {
    const entrypoint = join(directory, 'codex-acp.mjs');
    await writeFile(entrypoint, 'export {};');
    expect(resolveBundledBridge(policy, directory)).toEqual({
      available: true,
      entrypoint: await realpath(entrypoint),
    });
  });
});

test('reports a missing adapter asset', async () => {
  await withTemporaryDirectory(async (directory) => {
    expect(resolveBundledBridge(policy, directory)).toEqual({
      available: false,
      reason: 'entrypoint_invalid',
    });
  });
});

test('rejects a directory at the adapter path', async () => {
  await withTemporaryDirectory(async (directory) => {
    await mkdir(join(directory, 'codex-acp.mjs'));
    expect(resolveBundledBridge(policy, directory)).toEqual({
      available: false,
      reason: 'entrypoint_invalid',
    });
  });
});
