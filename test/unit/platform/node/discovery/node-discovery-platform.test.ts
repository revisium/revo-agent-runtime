import { join } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { defaultSystemExecutableProbe } from '../../../../../src/discovery/platform.js';
import {
  createNodeDiscoveryPlatform,
  nodeDiscoveryPlatform,
} from '../../../../../src/platform/node/discovery/platform.js';
import { ProcessStartError } from '../../../../../src/process/index.js';
import { nodeProcessLauncher } from '../../../../../src/process/node.js';
import { claudeProviderPolicy } from '../../../../../src/providers/claude/definition.js';
import { codexProviderPolicy } from '../../../../../src/providers/codex/definition.js';
import { adjacentNodePackage } from '../../../../support/builders/adjacent-node-package.js';
import { nodePackageEntrypoint } from '../../../../support/builders/node-package-entrypoint.js';
import {
  nonExecutableFile,
  systemExecutable,
} from '../../../../support/fixtures/system-executable.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('does not advertise an executable whose probe cleanup is uncertain', async () => {
  vi.spyOn(nodeProcessLauncher, 'start').mockRejectedValueOnce(new ProcessStartError('uncertain'));

  await expect(
    nodeDiscoveryPlatform.probeSystemExecutable(process.execPath, defaultSystemExecutableProbe),
  ).resolves.toBe(false);
});

test('does not look up an npm entrypoint after cancellation', async () => {
  const lookup = vi.fn(async () => undefined);
  const platform = createNodeDiscoveryPlatform('linux', { resolveSystemExecutable: lookup });

  await expect(
    platform.resolveNodePackageEntrypoint(
      { binName: 'fixture', command: 'fixture', packageName: '@fixture/agent' },
      undefined,
      AbortSignal.abort(),
    ),
  ).resolves.toBeUndefined();
  expect(lookup).not.toHaveBeenCalled();
});

test('resolves both exact bundled ACP bridge entrypoints', () => {
  const codex = nodeDiscoveryPlatform.resolveBundledBridge(codexProviderPolicy.bridge);
  const claude = nodeDiscoveryPlatform.resolveBundledBridge(claudeProviderPolicy.bridge);
  expect(codex.available).toBe(true);
  expect(claude.available).toBe(true);
  if (!codex.available || !claude.available) throw new Error('Expected exact bundled bridges.');
  expect(codex.entrypoint).toMatch(/codex-acp\.mjs$/);
  expect(claude.entrypoint).toMatch(/claude-agent-acp\.mjs$/);
});

test('looks up and probes system ACP commands without starting a session', async () => {
  expect(
    await nodeDiscoveryPlatform.resolveSystemExecutable(
      'revo-agent-runtime-command-that-does-not-exist',
    ),
  ).toBeUndefined();
  expect(
    await nodeDiscoveryPlatform.probeSystemExecutable(
      process.execPath,
      defaultSystemExecutableProbe,
    ),
  ).toBe(true);
  expect(
    await nodeDiscoveryPlatform.probeSystemExecutable(
      '/not/a/revo-agent-runtime-executable',
      defaultSystemExecutableProbe,
    ),
  ).toBe(false);
  expect(
    await nodeDiscoveryPlatform.probeSystemExecutable(process.cwd(), defaultSystemExecutableProbe),
  ).toBe(false);

  const cancelled = new AbortController();
  cancelled.abort();
  expect(
    await nodeDiscoveryPlatform.probeSystemExecutable(
      process.execPath,
      defaultSystemExecutableProbe,
      cancelled.signal,
    ),
  ).toBe(false);
});

describe('explicit system override', () => {
  test('probes an absolute override without inheriting application variables and canonicalizes it', async () => {
    vi.stubEnv('REVO_DISCOVERY_ENV_SENTINEL', 'must-not-be-inherited');
    const fixture = await systemExecutable('environment-sensitive-version');
    try {
      expect(
        await nodeDiscoveryPlatform.resolveSystemOverride(
          fixture.link,
          defaultSystemExecutableProbe,
        ),
      ).toBe(fixture.executable);
    } finally {
      await fixture.dispose();
    }
  });

  test('rejects invalid paths without searching or falling back', async () => {
    const fixture = await systemExecutable();
    try {
      const notExecutable = await nonExecutableFile(fixture.directory);
      await expect(
        Promise.all([
          nodeDiscoveryPlatform.resolveSystemOverride(
            fixture.relative,
            defaultSystemExecutableProbe,
          ),
          nodeDiscoveryPlatform.resolveSystemOverride(
            fixture.directory,
            defaultSystemExecutableProbe,
          ),
          nodeDiscoveryPlatform.resolveSystemOverride(notExecutable, defaultSystemExecutableProbe),
          nodeDiscoveryPlatform.resolveSystemOverride(
            join(fixture.directory, 'missing'),
            defaultSystemExecutableProbe,
          ),
        ]),
      ).resolves.toEqual([undefined, undefined, undefined, undefined]);
    } finally {
      await fixture.dispose();
    }
  });

  test('rejects a cancelled probe and discards version output', async () => {
    const fixture = await systemExecutable('large-version');
    const cancelled = new AbortController();
    cancelled.abort();
    try {
      await expect(
        Promise.all([
          nodeDiscoveryPlatform.resolveSystemOverride(
            fixture.executable,
            defaultSystemExecutableProbe,
            cancelled.signal,
          ),
          nodeDiscoveryPlatform.resolveSystemOverride(
            fixture.executable,
            defaultSystemExecutableProbe,
          ),
        ]),
      ).resolves.toEqual([undefined, fixture.executable]);
    } finally {
      await fixture.dispose();
    }
  });

  test('rejects an executable whose bounded version probe is incompatible', async () => {
    const fixture = await systemExecutable('incompatible-version');
    try {
      await expect(
        nodeDiscoveryPlatform.resolveSystemOverride(
          fixture.executable,
          defaultSystemExecutableProbe,
        ),
      ).resolves.toBeUndefined();
    } finally {
      await fixture.dispose();
    }
  });
});

test('accepts an explicit canonical Windows Node entrypoint', async () => {
  const policy = { binName: 'fixture', command: 'fixture-agent', packageName: '@fixture/agent' };
  const fixture = await nodePackageEntrypoint(policy);
  try {
    const platform = createNodeDiscoveryPlatform('win32');
    await expect(platform.resolveNodePackageEntrypoint(policy, fixture.packageBin)).resolves.toBe(
      fixture.entrypoint,
    );
  } finally {
    await fixture.dispose();
  }
});

test('resolves an explicit adjacent Windows Node package and honors cancellation', async () => {
  const layout = { command: 'agent', entrypointName: 'index.js', launcherName: 'cursor-agent' };
  const fixture = await adjacentNodePackage('valid', '2026.08.11-e8db854\n', 'node.exe');
  const cancelled = new AbortController();
  cancelled.abort();
  try {
    const platform = createNodeDiscoveryPlatform('win32');
    await expect(platform.resolveAdjacentNodePackage(layout, fixture.launcher)).resolves.toEqual({
      entrypoint: fixture.entrypoint,
      node: fixture.node,
    });
    await expect(
      platform.resolveAdjacentNodePackage(layout, fixture.launcher, cancelled.signal),
    ).resolves.toBeUndefined();
    await expect(
      platform.resolveAdjacentNodePackage({
        ...layout,
        command: 'revo-agent-runtime-missing-agent',
      }),
    ).resolves.toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});

test('discards an adjacent package candidate cancelled during lookup', async () => {
  const controller = new AbortController();
  const platform = createNodeDiscoveryPlatform('linux', {
    resolveSystemExecutable: async () => {
      controller.abort();
      return '/fixture/candidate';
    },
  });
  const lookup = platform.resolveAdjacentNodePackage(
    { command: 'fixture-agent', entrypointName: 'index.js', launcherName: 'cursor-agent' },
    undefined,
    controller.signal,
  );

  await expect(lookup).resolves.toBeUndefined();
});

test('discards an adjacent package lookup without a candidate', async () => {
  const platform = createNodeDiscoveryPlatform('linux', {
    resolveSystemExecutable: async () => undefined,
  });

  await expect(
    platform.resolveAdjacentNodePackage(
      { command: 'fixture-agent', entrypointName: 'index.js', launcherName: 'cursor-agent' },
      undefined,
      undefined,
    ),
  ).resolves.toBeUndefined();
});

test.each(['global', 'local'] as const)(
  'discovers the declared Node bin beside a Windows %s npm shim without executing it',
  async (windowsShim) => {
    const policy = { binName: 'fixture', command: 'fixture-agent', packageName: '@fixture/agent' };
    const fixture = await nodePackageEntrypoint(policy, 'valid', { windowsShim });
    try {
      const platform = createNodeDiscoveryPlatform('win32', {
        resolveSystemExecutable: async () => fixture.packageBin,
      });
      await expect(platform.resolveNodePackageEntrypoint(policy)).resolves.toBe(fixture.entrypoint);
    } finally {
      await fixture.dispose();
    }
  },
);

test.each([
  'absolute_bin',
  'different_name',
  'shim_directory',
  'escape',
  'missing_declared_bin',
  'no_shebang',
  'missing_bin',
] as const)('rejects a Windows npm shim with a %s package bin', async (mutation) => {
  const policy = { binName: 'fixture', command: 'fixture-agent', packageName: '@fixture/agent' };
  const fixture = await nodePackageEntrypoint(policy, mutation, { windowsShim: 'global' });
  try {
    const platform = createNodeDiscoveryPlatform('win32', {
      resolveSystemExecutable: async () => fixture.packageBin,
    });
    await expect(platform.resolveNodePackageEntrypoint(policy)).resolves.toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});

test('cancels a pending system version check', async () => {
  const controller = new AbortController();
  const result = nodeDiscoveryPlatform.probeSystemExecutable(
    process.execPath,
    {
      args: ['-e', 'setInterval(() => undefined, 1000)'],
      timeoutMs: 1000,
    },
    controller.signal,
  );
  controller.abort();
  await expect(result).resolves.toBe(false);
});

test('rejects a system version check that exceeds its deadline', async () => {
  await expect(
    nodeDiscoveryPlatform.probeSystemExecutable(process.execPath, {
      args: ['-e', 'setInterval(() => undefined, 1000)'],
      timeoutMs: 10,
    }),
  ).resolves.toBe(false);
});

test('does not associate an unrelated Windows command with an adjacent package', async () => {
  const policy = { binName: 'fixture', command: 'fixture-agent', packageName: '@fixture/agent' };
  const fixture = await nodePackageEntrypoint(policy, 'valid', { windowsShim: 'global' });
  try {
    const platform = createNodeDiscoveryPlatform('win32', {
      resolveSystemExecutable: async () => fixture.packageBin,
    });
    await expect(
      platform.resolveNodePackageEntrypoint({ ...policy, command: 'another-command' }),
    ).resolves.toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});
