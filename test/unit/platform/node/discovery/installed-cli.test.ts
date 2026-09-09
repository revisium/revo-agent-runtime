import { chmod, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { expect, test } from 'vitest';

import { installedCliExecutable } from '../../../../../src/platform/node/discovery/installed-cli.js';
import { createNodeDiscoveryPlatform } from '../../../../../src/platform/node/discovery/platform.js';
import { claudeProviderPolicy } from '../../../../../src/providers/claude/definition.js';
import { codexProviderPolicy } from '../../../../../src/providers/codex/definition.js';
import { withTemporaryDirectory } from '../../../../support/assertions/temporary-directory.js';
import { nodePackageEntrypoint } from '../../../../support/builders/node-package-entrypoint.js';
import { systemExecutable } from '../../../../support/fixtures/system-executable.js';

const codex = codexProviderPolicy.cli;
const packagePolicy = { ...codex, binName: 'codex' };
const nativeFile = async (path: string): Promise<string> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, 'native fixture');
  await chmod(path, 0o755);
  return realpath(path);
};

const targets = [
  ['linux', 'x64', 'x86_64-unknown-linux-musl'],
  ['linux', 'arm64', 'aarch64-unknown-linux-musl'],
  ['darwin', 'x64', 'x86_64-apple-darwin'],
  ['darwin', 'arm64', 'aarch64-apple-darwin'],
  ['win32', 'x64', 'x86_64-pc-windows-msvc'],
  ['win32', 'arm64', 'aarch64-pc-windows-msvc'],
] as const;

test.each(targets)(
  'finds the native Codex npm dependency on %s/%s',
  async (platform, arch, target) => {
    const fixture = await nodePackageEntrypoint(packagePolicy, 'valid', { windowsShim: 'global' });
    try {
      const root = dirname(dirname(fixture.entrypoint));
      const nativePackage = join(root, 'node_modules', `@openai/codex-${platform}-${arch}`);
      await mkdir(nativePackage, { recursive: true });
      await writeFile(
        join(nativePackage, 'package.json'),
        JSON.stringify({ name: `@openai/codex-${platform}-${arch}` }),
      );
      const executable = await nativeFile(
        join(nativePackage, 'vendor', target, 'bin', platform === 'win32' ? 'codex.exe' : 'codex'),
      );
      const candidate = platform === 'win32' ? fixture.packageBin : fixture.entrypoint;

      expect(installedCliExecutable(codex, candidate, platform, arch)).toBe(executable);
    } finally {
      await fixture.dispose();
    }
  },
);

test('finds the older Codex vendor layout within the selected installation', async () => {
  const fixture = await nodePackageEntrypoint(packagePolicy);
  try {
    const executable = await nativeFile(
      join(
        dirname(dirname(fixture.entrypoint)),
        'vendor',
        'x86_64-unknown-linux-musl',
        'codex',
        'codex',
      ),
    );
    expect(installedCliExecutable(codex, fixture.entrypoint, 'linux', 'x64')).toBe(executable);
  } finally {
    await fixture.dispose();
  }
});

test('keeps a broken npm installation unavailable instead of selecting another CLI', async () => {
  const fixture = await nodePackageEntrypoint(packagePolicy);
  try {
    expect(installedCliExecutable(codex, fixture.entrypoint, 'linux', 'x64')).toBeUndefined();
    expect(installedCliExecutable(codex, fixture.entrypoint, 'linux', 'riscv64')).toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});

test('requires the native package identity when a provider declares native targets', async () => {
  const fixture = await nodePackageEntrypoint(packagePolicy);
  try {
    const { nativePackagePrefix: _prefix, ...incomplete } = codex;
    expect(installedCliExecutable(incomplete, fixture.entrypoint, 'linux', 'x64')).toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});

test.each(['global', 'local'] as const)(
  'resolves a native Claude bin behind a Windows %s npm shim',
  async (windowsShim) => {
    const policy = { ...claudeProviderPolicy.cli, binName: 'claude' };
    const fixture = await nodePackageEntrypoint(policy, 'no_shebang', { windowsShim });
    try {
      await chmod(fixture.entrypoint, 0o755);
      expect(installedCliExecutable(policy, fixture.packageBin, 'win32')).toBe(fixture.entrypoint);
    } finally {
      await fixture.dispose();
    }
  },
);

test('accepts a standalone installation without npm metadata', async () => {
  expect(installedCliExecutable(codex, process.execPath, process.platform)).toBe(
    await realpath(process.execPath),
  );
});

test('rejects relative, missing and directory selections', async () => {
  await withTemporaryDirectory(async (directory) => {
    expect(installedCliExecutable(codex, 'codex', process.platform)).toBeUndefined();
    expect(
      installedCliExecutable(codex, join(directory, 'missing'), process.platform),
    ).toBeUndefined();
    expect(installedCliExecutable(codex, directory, process.platform)).toBeUndefined();
  });
});

test('does not execute an unrecognized Windows script', async () => {
  await withTemporaryDirectory(async (directory) => {
    const script = await nativeFile(join(directory, 'custom.cmd'));
    expect(installedCliExecutable(codex, script, 'win32')).toBeUndefined();
  });
});

test('rejects a Windows package bin that is a directory', async () => {
  const fixture = await nodePackageEntrypoint(
    { ...claudeProviderPolicy.cli, binName: 'claude' },
    'valid',
    { windowsShim: 'global' },
  );
  try {
    await rm(fixture.entrypoint);
    await mkdir(fixture.entrypoint);
    expect(
      installedCliExecutable(claudeProviderPolicy.cli, fixture.packageBin, 'win32'),
    ).toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});

test('probes a CLI discovered through PATH without requiring credentials', async () => {
  const platform = createNodeDiscoveryPlatform(process.platform, {
    resolveSystemExecutable: async () => process.execPath,
  });
  await expect(platform.resolveInstalledCli(claudeProviderPolicy.cli)).resolves.toBe(
    await realpath(process.execPath),
  );
});

test('does not search PATH after cancellation', async () => {
  const platform = createNodeDiscoveryPlatform(process.platform, {
    resolveSystemExecutable: async () => {
      throw new Error('Unexpected lookup');
    },
  });
  await expect(
    platform.resolveInstalledCli(codex, undefined, AbortSignal.abort()),
  ).resolves.toBeUndefined();
});

test('discards a CLI lookup cancelled while PATH resolution is pending', async () => {
  const controller = new AbortController();
  const platform = createNodeDiscoveryPlatform(process.platform, {
    resolveSystemExecutable: async () => {
      controller.abort();
      return process.execPath;
    },
  });
  await expect(
    platform.resolveInstalledCli(codex, undefined, controller.signal),
  ).resolves.toBeUndefined();
});

test('rejects an explicit CLI path that cannot identify an executable', async () => {
  await expect(
    createNodeDiscoveryPlatform().resolveInstalledCli(codex, 'relative-codex'),
  ).resolves.toBeUndefined();
});

test('omits a CLI whose version command fails', async () => {
  const fixture = await systemExecutable('incompatible-version');
  try {
    await expect(
      createNodeDiscoveryPlatform().resolveInstalledCli(codex, fixture.executable),
    ).resolves.toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});
