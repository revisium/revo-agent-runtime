import {
  constants,
  accessSync,
  closeSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

import type { NodePackageEntrypointPolicy } from '../../../discovery/platform.js';

interface PackageManifest {
  readonly bin?: unknown;
  readonly name?: unknown;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readManifest = (path: string): PackageManifest | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const packageBin = (
  manifest: PackageManifest,
  policy: NodePackageEntrypointPolicy,
): string | undefined => {
  if (!isRecord(manifest.bin)) return undefined;
  const value = manifest.bin[policy.binName];
  return typeof value === 'string' && !isAbsolute(value) ? value : undefined;
};

const hasNodeShebang = (path: string): boolean => {
  const descriptor = openSync(path, 'r');
  try {
    const bytes = Buffer.alloc(256);
    const length = readSync(descriptor, bytes, 0, bytes.byteLength, 0);
    return /^#!.*\bnode(?:\s|$)/.test(bytes.toString('utf8', 0, length).split('\n', 1).join(''));
  } finally {
    closeSync(descriptor);
  }
};

const packageRootFor = (
  candidate: string,
  packageName: string,
): Readonly<{ candidate: string; root: string; manifest: PackageManifest }> | undefined => {
  try {
    const canonicalCandidate = realpathSync(candidate);
    if (!statSync(canonicalCandidate).isFile()) return undefined;
    let root = dirname(canonicalCandidate);
    for (let depth = 0; depth < 8; depth += 1) {
      const manifest = readManifest(join(root, 'package.json'));
      if (manifest?.name === packageName) return { candidate: canonicalCandidate, manifest, root };
      root = dirname(root);
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/** Resolves only the canonical Node package bin declared by a known provider. */
export const resolveNodePackageEntrypoint = (
  policy: NodePackageEntrypointPolicy,
  candidate: string,
): string | undefined => {
  const packageRoot = packageRootFor(candidate, policy.packageName);
  const declaredBin =
    packageRoot === undefined ? undefined : packageBin(packageRoot.manifest, policy);
  if (packageRoot === undefined || declaredBin === undefined) return undefined;
  try {
    const entrypoint = realpathSync(join(packageRoot.root, declaredBin));
    if (entrypoint !== packageRoot.candidate || !statSync(entrypoint).isFile()) return undefined;
    accessSync(entrypoint, constants.R_OK);
    return hasNodeShebang(entrypoint) ? entrypoint : undefined;
  } catch {
    return undefined;
  }
};

/** Uses known npm layout and package metadata, never the contents of a Windows shim. */
export const resolveWindowsPackageBin = (
  policy: NodePackageEntrypointPolicy,
  candidate: string,
): string | undefined => {
  const direct = resolveNodePackageEntrypoint(policy, candidate);
  if (direct !== undefined) return direct;
  try {
    const shim = realpathSync(candidate);
    if (
      basename(shim).toLowerCase() !== `${policy.command}.cmd`.toLowerCase() ||
      !statSync(shim).isFile()
    )
      return undefined;
    const directory = dirname(shim);
    const modules =
      basename(directory) === '.bin' && basename(dirname(directory)) === 'node_modules'
        ? dirname(directory)
        : join(directory, 'node_modules');
    const root = realpathSync(join(modules, policy.packageName));
    const manifest = readManifest(join(root, 'package.json'));
    if (manifest?.name !== policy.packageName) return undefined;
    const declaredBin = packageBin(manifest, policy);
    if (declaredBin === undefined) return undefined;
    const entrypoint = realpathSync(join(root, declaredBin));
    const fromRoot = relative(root, entrypoint);
    if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) return undefined;
    if (!statSync(entrypoint).isFile()) return undefined;
    accessSync(entrypoint, constants.R_OK);
    return entrypoint;
  } catch {
    return undefined;
  }
};

export const resolveWindowsNodePackageEntrypoint = (
  policy: NodePackageEntrypointPolicy,
  candidate: string,
): string | undefined => {
  const entrypoint = resolveWindowsPackageBin(policy, candidate);
  return entrypoint === undefined ? undefined : resolveNodePackageEntrypoint(policy, entrypoint);
};
