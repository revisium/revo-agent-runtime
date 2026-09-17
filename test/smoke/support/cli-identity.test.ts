import { realpathSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

import { expect, test } from 'vitest';

import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import {
  canonicalExecutableOnPath,
  formatCliIdentity,
  liveDiscoveryOptions,
  pinNodeRuntimeWithoutVendorShadow,
} from './cli-identity.js';
import { builtInProviderIds } from './provider-selection.js';

const writeCli = async (directory: string, name: string, version: string): Promise<string> => {
  const executable = join(directory, name);
  await writeFile(executable, `#!/bin/sh\necho ${version}\n`);
  await chmod(executable, 0o755);
  return realpathSync.native(executable);
};

test('two fixture CLIs: Node-bin first shadows the vendor executable', async () => {
  await withTemporaryDirectory(async (root) => {
    const nodeBin = join(root, 'node-bin');
    const vendorBin = join(root, 'local-bin');
    await mkdir(nodeBin);
    await mkdir(vendorBin);
    const shadowed = await writeCli(nodeBin, 'codex', '0.145.0');
    const selected = await writeCli(vendorBin, 'codex', '0.154.0');
    const pathWithNodeFirst = `${nodeBin}${delimiter}${vendorBin}`;
    expect(canonicalExecutableOnPath('codex', pathWithNodeFirst)).toBe(shadowed);
    expect(canonicalExecutableOnPath('codex', pathWithNodeFirst)).not.toBe(selected);
  });
});

test('two fixture CLIs: pinning Node runtime without vendor shadow selects the vendor executable', async () => {
  await withTemporaryDirectory(async (root) => {
    const nodeBin = join(root, 'node-bin');
    const vendorBin = join(root, 'local-bin');
    await mkdir(nodeBin);
    await mkdir(vendorBin);
    const shadowed = await writeCli(nodeBin, 'codex', '0.145.0');
    const selected = await writeCli(vendorBin, 'codex', '0.154.0');
    const originalPath = `${vendorBin}${delimiter}/usr/bin`;
    const unshadowed = pinNodeRuntimeWithoutVendorShadow(
      `${nodeBin}${delimiter}${originalPath}`,
      nodeBin,
    );
    expect(unshadowed.split(delimiter)[0]).toBe(vendorBin);
    expect(unshadowed.split(delimiter).at(-1)).toBe(nodeBin);
    expect(canonicalExecutableOnPath('codex', unshadowed)).toBe(selected);
    expect(canonicalExecutableOnPath('codex', unshadowed)).not.toBe(shadowed);
    expect(liveDiscoveryOptions('codex', selected)).toEqual({
      disabledDetectorIds: builtInProviderIds.filter((id) => id !== 'codex'),
      systemExecutableOverrides: { codex: selected },
    });
  });
});

test('records canonical CLI path and version before live calls', () => {
  expect(formatCliIdentity('codex-acp', '/selected/codex', '0.154.0')).toBe(
    'codex-acp: cli=/selected/codex; version=0.154.0',
  );
});

test('omits a public override when no canonical executable is resolved', () => {
  expect(liveDiscoveryOptions('opencode', undefined)).toEqual({
    disabledDetectorIds: builtInProviderIds.filter((id) => id !== 'opencode'),
  });
});
