import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { execa } from 'execa';
import which from 'which';

import type {
  AdjacentNodePackage,
  AdjacentNodePackagePolicy,
  DiscoveryPlatform,
  NodePackageEntrypointPolicy,
  SystemExecutableProbe,
} from '../../../discovery/platform.js';
import { resolveAdjacentNodePackage } from './adjacent-node-package.js';
import { resolveBundledBridge } from './bundled-bridge.js';
import { resolveNodePackageEntrypoint } from './node-entrypoint.js';

const probeSystemExecutable = async (
  executable: string,
  probe: SystemExecutableProbe,
  signal?: AbortSignal,
): Promise<boolean> => {
  if (signal?.aborted) return false;
  const result = await execa(executable, probe.args, {
    ...(signal === undefined ? {} : { cancelSignal: signal }),
    env: {},
    extendEnv: false,
    reject: false,
    shell: false,
    stderr: 'ignore',
    stdout: 'ignore',
    timeout: probe.timeoutMs,
    windowsHide: true,
  });
  return result.exitCode === 0;
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

const nodeExecutableName = (hostPlatform: NodeJS.Platform): string => {
  if (hostPlatform === 'win32') return 'node.exe';
  return 'node';
};

const resolveNodePackageEntrypointFor = async (
  hostPlatform: NodeJS.Platform,
  policy: NodePackageEntrypointPolicy,
  override: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string | undefined> => {
  if ((hostPlatform === 'win32' && override === undefined) || signal?.aborted) return undefined;
  const candidate = override ?? (await resolveSystemExecutable(policy.command));
  return candidate === undefined || signal?.aborted
    ? undefined
    : resolveNodePackageEntrypoint(policy, candidate);
};

const resolveAdjacentNodePackageFor = async (
  hostPlatform: NodeJS.Platform,
  policy: AdjacentNodePackagePolicy,
  override: string | undefined,
  signal: AbortSignal | undefined,
): Promise<AdjacentNodePackage | undefined> => {
  if (signal?.aborted) return undefined;
  const candidate = override ?? (await resolveSystemExecutable(policy.command));
  if (candidate === undefined || signal?.aborted) return undefined;
  return resolveAdjacentNodePackage(policy, candidate, nodeExecutableName(hostPlatform));
};

export const createNodeDiscoveryPlatform = (
  hostPlatform: NodeJS.Platform = process.platform,
): DiscoveryPlatform =>
  Object.freeze({
    probeSystemExecutable,
    resolveAdjacentNodePackage: (
      policy: AdjacentNodePackagePolicy,
      override: string | undefined,
      signal: AbortSignal | undefined,
    ) => resolveAdjacentNodePackageFor(hostPlatform, policy, override, signal),
    resolveBundledBridge,
    resolveNodePackageEntrypoint: (
      policy: NodePackageEntrypointPolicy,
      override: string | undefined,
      signal: AbortSignal | undefined,
    ) => resolveNodePackageEntrypointFor(hostPlatform, policy, override, signal),
    resolveSystemExecutable,
    resolveSystemOverride,
  });

export const nodeDiscoveryPlatform = createNodeDiscoveryPlatform();
