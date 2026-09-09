import { constants, accessSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join } from 'node:path';

import type { InstalledCliPolicy } from '../../../discovery/platform.js';
import { resolveNodePackageEntrypoint, resolveWindowsPackageBin } from './node-entrypoint.js';

const executableFile = (path: string): string | undefined => {
  try {
    const canonical = realpathSync.native(path);
    if (!statSync(canonical).isFile()) return undefined;
    accessSync(canonical, constants.R_OK | constants.X_OK);
    return canonical;
  } catch {
    return undefined;
  }
};

/** Resolve a native package relative to the selected npm installation, never runtime dependencies. */
const nativePackageExecutable = (
  policy: InstalledCliPolicy,
  entrypoint: string,
  platform: NodeJS.Platform,
  arch: string,
): string | undefined => {
  const target = policy.nativeTargets?.[`${platform}-${arch}`];
  if (target === undefined || policy.nativePackagePrefix === undefined) return undefined;
  let vendorRoot;
  try {
    const manifest = createRequire(entrypoint).resolve(
      `${policy.nativePackagePrefix}-${platform}-${arch}/package.json`,
    );
    vendorRoot = join(dirname(manifest), 'vendor');
  } catch {
    vendorRoot = join(dirname(entrypoint), '..', 'vendor');
  }
  const name = platform === 'win32' ? `${policy.command}.exe` : policy.command;
  // Current npm packages use bin/; earlier releases used a command-named directory.
  return (
    executableFile(join(vendorRoot, target, 'bin', name)) ??
    executableFile(join(vendorRoot, target, policy.command, name))
  );
};

export const installedCliExecutable = (
  policy: InstalledCliPolicy,
  candidate: string,
  platform: NodeJS.Platform,
  arch = process.arch,
): string | undefined => {
  if (!isAbsolute(candidate)) return undefined;
  const packagePolicy = { ...policy, binName: policy.command };
  const packageBin =
    platform === 'win32'
      ? resolveWindowsPackageBin(packagePolicy, candidate)
      : resolveNodePackageEntrypoint(packagePolicy, candidate);
  if (packageBin !== undefined && policy.nativeTargets !== undefined) {
    return nativePackageExecutable(policy, packageBin, platform, arch);
  }
  const executable = packageBin ?? candidate;
  if (platform === 'win32' && ['.cmd', '.bat', '.ps1'].includes(extname(executable).toLowerCase()))
    return undefined;
  return executableFile(executable);
};
