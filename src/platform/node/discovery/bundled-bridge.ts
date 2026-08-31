import assert from 'node:assert/strict';
import { constants, existsSync, realpathSync, readFileSync, statSync, accessSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, parse, relative } from 'node:path';

import type { BridgePackagePolicy } from '../../../discovery/platform.js';

export type BundledBridgeResolution =
  | { readonly available: true; readonly entrypoint: string }
  | {
      readonly available: false;
      readonly reason:
        | 'bin_invalid'
        | 'entrypoint_invalid'
        | 'manifest_invalid'
        | 'package_unavailable'
        | 'vendor_dependency_invalid'
        | 'version_mismatch';
    };

/** Provider-owned package identity supplied to generic bundled bridge mechanics. */
interface PackageManifest {
  readonly bin?: unknown;
  readonly dependencies?: unknown;
  readonly name?: unknown;
  readonly version?: unknown;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readManifest = (path: string): PackageManifest | undefined => {
  if (!existsSync(path)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return isRecord(parsed) ? parsed : undefined;
};

const resolveExportedManifest = (packageName: string, base: string): string | undefined => {
  try {
    const resolver = createRequire(base);
    const resolvedManifest = realpathSync(resolver.resolve(`${packageName}/package.json`));
    const searchPaths = resolver.resolve.paths(packageName);
    assert(searchPaths !== null, 'Bridge packages require Node module search paths.');
    return searchPaths
      .map((nodeModules) => join(nodeModules, ...packageName.split('/'), 'package.json'))
      .find((candidate) => {
        try {
          return realpathSync(candidate) === resolvedManifest;
        } catch {
          return false;
        }
      });
  } catch {
    return undefined;
  }
};

const resolveInstalledManifest = (packageName: string, base: string): string | undefined => {
  const exportedManifest = resolveExportedManifest(packageName, base);
  if (exportedManifest !== undefined) return exportedManifest;
  try {
    const installedEntrypoint = realpathSync(createRequire(base).resolve(packageName));
    let candidateRoot = dirname(installedEntrypoint);
    const filesystemRoot = parse(candidateRoot).root;
    for (let depth = 0; depth < 8 && candidateRoot !== filesystemRoot; depth += 1) {
      const candidateManifest = join(candidateRoot, 'package.json');
      const manifest = readManifest(candidateManifest);
      if (manifest?.name === packageName && isContained(candidateRoot, installedEntrypoint)) {
        return candidateManifest;
      }
      candidateRoot = dirname(candidateRoot);
    }
    return undefined;
  } catch {
    return undefined;
  }
};

const isContained = (root: string, path: string): boolean => {
  const fromRoot = relative(root, path);
  return fromRoot !== '' && !fromRoot.startsWith('..') && !isAbsolute(fromRoot);
};

const resolveEntrypoint = (
  manifestPath: string,
  manifest: PackageManifest,
  policy: BridgePackagePolicy,
): BundledBridgeResolution => {
  if (!isRecord(manifest.bin) || manifest.bin[policy.binName] !== 'dist/index.js') {
    return { available: false, reason: 'bin_invalid' };
  }

  try {
    const packageRoot = realpathSync(dirname(manifestPath));
    const entrypoint = realpathSync(join(packageRoot, 'dist/index.js'));
    if (!isContained(packageRoot, entrypoint) || !statSync(entrypoint).isFile()) {
      return { available: false, reason: 'entrypoint_invalid' };
    }
    accessSync(entrypoint, constants.R_OK);
    return { available: true, entrypoint };
  } catch {
    return { available: false, reason: 'entrypoint_invalid' };
  }
};

const hasExpectedVendor = (
  manifestPath: string,
  manifest: PackageManifest,
  policy: BridgePackagePolicy,
): boolean => {
  if (
    !isRecord(manifest.dependencies) ||
    manifest.dependencies[policy.vendorName] !== policy.vendorDependencyRange
  ) {
    return false;
  }

  const installedManifestPath = realpathSync(manifestPath);
  const vendorManifestPath = resolveInstalledManifest(policy.vendorName, installedManifestPath);
  if (vendorManifestPath === undefined) return false;
  const vendorManifest = readManifest(vendorManifestPath);
  return (
    vendorManifest?.name === policy.vendorName && vendorManifest.version === policy.vendorVersion
  );
};

export const resolveBundledBridge = (
  policy: BridgePackagePolicy,
  anchor: string = import.meta.url,
): BundledBridgeResolution => {
  const manifestPath = resolveExportedManifest(policy.bridgeName, anchor);
  if (manifestPath === undefined) return { available: false, reason: 'package_unavailable' };

  const manifest = readManifest(manifestPath);
  if (manifest === undefined || manifest.name !== policy.bridgeName) {
    return { available: false, reason: 'manifest_invalid' };
  }
  const packageRoot = realpathSync(dirname(manifestPath));
  if (!isContained(packageRoot, realpathSync(manifestPath))) {
    return { available: false, reason: 'manifest_invalid' };
  }
  if (manifest.version !== policy.bridgeVersion) {
    return { available: false, reason: 'version_mismatch' };
  }
  if (!hasExpectedVendor(manifestPath, manifest, policy)) {
    return { available: false, reason: 'vendor_dependency_invalid' };
  }
  return resolveEntrypoint(manifestPath, manifest, policy);
};
