import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import which from 'which';

import type {
  AdjacentNodePackage,
  AdjacentNodePackagePolicy,
  DiscoveryPlatform,
  InstalledCliPolicy,
  NodePackageEntrypointPolicy,
  SystemExecutableProbe,
} from '../../../discovery/platform.js';
import { nodeExecutableProbe } from '../probe/executable-probe.js';
import { resolveAdjacentNodePackage } from './adjacent-node-package.js';
import { resolveBundledBridge } from './bundled-bridge.js';
import { installedCliExecutable } from './installed-cli.js';
import {
  resolveNodePackageEntrypoint,
  resolveWindowsNodePackageEntrypoint,
} from './node-entrypoint.js';

const probeSystemExecutable = async (
  executable: string,
  probe: SystemExecutableProbe,
  signal?: AbortSignal,
): Promise<boolean> => {
  if (signal?.aborted) return false;
  let onAbort!: () => void;
  const cancelled = new Promise<undefined>((resolve) => {
    onAbort = () => resolve(undefined);
  });
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const running = await nodeExecutableProbe.startVersionProbe({
      executable,
      args: probe.args,
      environment: {},
      shell: false,
      stderrLimitBytes: 65_536,
      stdoutLimitBytes: 65_536,
      timeoutMs: probe.timeoutMs,
    });
    try {
      const result = signal?.aborted
        ? undefined
        : await Promise.race([
            running.completion,
            running.timeout.then(() => undefined),
            cancelled,
          ]);
      return (
        result?.status === 'exited' &&
        result.exitCode === 0 &&
        result.signal === null &&
        result.overflow === 'none'
      );
    } finally {
      await running.terminateAndReap();
    }
  } catch {
    return false;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
};

const resolveSystemOverride = async (
  executable: string,
  probe: SystemExecutableProbe,
  signal?: AbortSignal,
): Promise<string | undefined> => {
  if (signal?.aborted || !isAbsolute(executable)) return undefined;
  try {
    const canonicalPath = await realpath(executable);
    const details = await stat(canonicalPath);
    if (!details.isFile()) return undefined;
    await access(canonicalPath, constants.R_OK | constants.X_OK);
    return (await probeSystemExecutable(canonicalPath, probe, signal)) ? canonicalPath : undefined;
  } catch {
    return undefined;
  }
};

const resolveSystemExecutable = async (command: string): Promise<string | undefined> =>
  (await which(command, { nothrow: true })) ?? undefined;

const resolveSystemExecutables = async (command: string): Promise<readonly string[]> => {
  const resolved = await which(command, { all: true, nothrow: true });
  return resolved ?? [];
};

interface NodeDiscoveryPlatformDependencies {
  readonly resolveSystemExecutable: typeof resolveSystemExecutable;
  readonly resolveSystemExecutables?: typeof resolveSystemExecutables;
}

const defaultNodeDiscoveryPlatformDependencies: NodeDiscoveryPlatformDependencies = Object.freeze({
  resolveSystemExecutable,
  resolveSystemExecutables,
});

const nodeExecutableName = (hostPlatform: NodeJS.Platform): string => {
  if (hostPlatform === 'win32') return 'node.exe';
  return 'node';
};

const resolveNodePackageEntrypointFor = async (
  hostPlatform: NodeJS.Platform,
  policy: NodePackageEntrypointPolicy,
  override: string | undefined,
  signal: AbortSignal | undefined,
  dependencies: NodeDiscoveryPlatformDependencies,
): Promise<string | undefined> => {
  if (signal?.aborted) return undefined;
  const candidate = override ?? (await dependencies.resolveSystemExecutable(policy.command));
  if (candidate === undefined || signal?.aborted) return undefined;
  if (hostPlatform === 'win32') return resolveWindowsNodePackageEntrypoint(policy, candidate);
  return resolveNodePackageEntrypoint(policy, candidate);
};

const resolveAdjacentNodePackageFor = async (
  hostPlatform: NodeJS.Platform,
  policy: AdjacentNodePackagePolicy,
  override: string | undefined,
  signal: AbortSignal | undefined,
  dependencies: NodeDiscoveryPlatformDependencies,
): Promise<AdjacentNodePackage | undefined> => {
  if (signal?.aborted) return undefined;
  const candidate = override ?? (await dependencies.resolveSystemExecutable(policy.command));
  if (candidate === undefined) return undefined;
  if (signal?.aborted) return undefined;
  return resolveAdjacentNodePackage(policy, candidate, nodeExecutableName(hostPlatform));
};

export const createNodeDiscoveryPlatform = (
  hostPlatform: NodeJS.Platform = process.platform,
  dependencies: NodeDiscoveryPlatformDependencies = defaultNodeDiscoveryPlatformDependencies,
): DiscoveryPlatform =>
  Object.freeze({
    probeSystemExecutable,
    resolveInstalledClis: async (
      policy: InstalledCliPolicy,
      override: string | undefined,
      signal: AbortSignal | undefined,
    ) => {
      if (signal?.aborted) return [];
      const candidates =
        override === undefined
          ? await (dependencies.resolveSystemExecutables ?? resolveSystemExecutables)(
              policy.command,
            )
          : [override];
      const executables: string[] = [];
      const seen = new Set<string>();
      for (const candidate of candidates) {
        if (signal?.aborted) return [];
        const executable = installedCliExecutable(policy, candidate, hostPlatform);
        if (executable === undefined || seen.has(executable)) continue;
        seen.add(executable);
        executables.push(executable);
      }
      const probes = await Promise.all(
        executables.map(async (executable) => ({
          available: await probeSystemExecutable(
            executable,
            { args: ['--version'], timeoutMs: policy.versionProbeTimeoutMs },
            signal,
          ),
          executable,
        })),
      );
      if (signal?.aborted) return [];
      return Object.freeze(
        probes.filter(({ available }) => available).map(({ executable }) => executable),
      );
    },
    resolveAdjacentNodePackage: (
      policy: AdjacentNodePackagePolicy,
      override: string | undefined,
      signal: AbortSignal | undefined,
    ) => resolveAdjacentNodePackageFor(hostPlatform, policy, override, signal, dependencies),
    resolveBundledBridge,
    resolveNodePackageEntrypoint: (
      policy: NodePackageEntrypointPolicy,
      override: string | undefined,
      signal: AbortSignal | undefined,
    ) => resolveNodePackageEntrypointFor(hostPlatform, policy, override, signal, dependencies),
    resolveSystemExecutable: dependencies.resolveSystemExecutable,
    resolveSystemOverride,
  });

export const nodeDiscoveryPlatform = createNodeDiscoveryPlatform();
