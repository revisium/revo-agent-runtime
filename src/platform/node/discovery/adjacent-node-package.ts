import { constants, accessSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

import type {
  AdjacentNodePackage,
  AdjacentNodePackagePolicy,
} from '../../../discovery/platform.js';

const isContained = (root: string, path: string): boolean => {
  const fromRoot = relative(root, path);
  return fromRoot !== '' && !fromRoot.startsWith('..') && !isAbsolute(fromRoot);
};

const readableFile = (path: string, mode: number): string | undefined => {
  try {
    const canonicalPath = realpathSync(path);
    if (!statSync(canonicalPath).isFile()) return undefined;
    accessSync(canonicalPath, mode);
    return canonicalPath;
  } catch {
    return undefined;
  }
};

const packageRootFor = (
  policy: AdjacentNodePackagePolicy,
  candidate: string,
): Readonly<{ launcher: string; root: string }> | undefined => {
  const canonicalCandidate = readableFile(candidate, constants.R_OK);
  if (canonicalCandidate !== undefined) {
    if (basename(canonicalCandidate) !== policy.launcherName) return undefined;
    return { launcher: canonicalCandidate, root: dirname(canonicalCandidate) };
  }
  try {
    const root = realpathSync(candidate);
    return statSync(root).isDirectory()
      ? { launcher: join(root, policy.launcherName), root }
      : undefined;
  } catch {
    return undefined;
  }
};

/** Resolves a known layout without running or parsing its launcher script. */
export const resolveAdjacentNodePackage = (
  policy: AdjacentNodePackagePolicy,
  candidate: string,
  nodeName: string,
): AdjacentNodePackage | undefined => {
  const packageRoot = packageRootFor(policy, candidate);
  if (packageRoot === undefined) return undefined;
  const launcher = readableFile(packageRoot.launcher, constants.R_OK);
  const entrypoint = readableFile(join(packageRoot.root, policy.entrypointName), constants.R_OK);
  const node = readableFile(join(packageRoot.root, nodeName), constants.R_OK | constants.X_OK);
  if (
    launcher === undefined ||
    entrypoint === undefined ||
    node === undefined ||
    !isContained(packageRoot.root, launcher) ||
    !isContained(packageRoot.root, entrypoint) ||
    !isContained(packageRoot.root, node)
  )
    return undefined;
  return Object.freeze({ entrypoint, node });
};
