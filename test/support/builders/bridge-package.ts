import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { BridgePackagePolicy } from '../../../src/discovery/platform.js';

interface BridgePackageMutation {
  /** Simulates an unrelated ancestor installation that must not satisfy this fixture. */
  readonly ancestorPackage?: BridgePackagePolicy;
  readonly bin?: string | Readonly<Record<string, string>>;
  readonly bridgeName?: string;
  readonly bridgeVersion?: string;
  readonly dependencyRange?: string;
  readonly entry?: 'directory' | 'escape' | 'file' | 'missing';
  readonly manifest?: 'escape' | 'invalid' | 'missing' | 'valid';
  readonly vendor?:
    | 'hoisted'
    | 'mismatched'
    | 'missing'
    | 'nested'
    | 'unexported'
    | 'unidentifiable';
}

interface BridgeFixture {
  readonly anchor: string;
  readonly dispose: () => Promise<void>;
  readonly expectedEntrypoint: string;
}

const packageDirectory = (nodeModules: string, packageName: string): string =>
  join(nodeModules, ...packageName.split('/'));

const writePackageManifest = async (
  directory: string,
  manifest: Readonly<Record<string, unknown>>,
): Promise<void> => {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
};

const writeBridgeEntrypoint = async (
  bridgeDirectory: string,
  entry: NonNullable<BridgePackageMutation['entry']>,
  fixtureRoot: string,
): Promise<void> => {
  const entrypoint = join(bridgeDirectory, 'dist/index.js');
  if (entry === 'missing') return;
  await mkdir(dirname(entrypoint), { recursive: true });
  if (entry === 'directory') {
    await mkdir(entrypoint);
    return;
  }
  if (entry === 'escape') {
    const escaped = join(fixtureRoot, 'escaped-entry.js');
    await writeFile(escaped, 'export {};\n', 'utf8');
    await symlink(escaped, entrypoint);
    return;
  }
  await writeFile(entrypoint, 'export {};\n', 'utf8');
  await chmod(entrypoint, 0o644);
};

const writeVendorPackage = async (
  consumerNodeModules: string,
  bridgeDirectory: string,
  policy: BridgePackagePolicy,
  vendor: NonNullable<BridgePackageMutation['vendor']>,
): Promise<void> => {
  const nodeModules =
    vendor === 'nested' ? join(bridgeDirectory, 'node_modules') : consumerNodeModules;
  const directory = packageDirectory(nodeModules, policy.vendorName);
  if (vendor === 'missing') {
    await writePackageManifest(directory, { exports: {}, name: policy.vendorName });
    return;
  }
  if (vendor === 'unexported' || vendor === 'unidentifiable') {
    await writePackageManifest(directory, {
      exports: { '.': './dist/index.js' },
      name: vendor === 'unidentifiable' ? '@vendor/wrong-package' : policy.vendorName,
      version: policy.vendorVersion,
    });
    await mkdir(join(directory, 'dist'), { recursive: true });
    await writeFile(join(directory, 'dist/index.js'), 'export {};\n', 'utf8');
    await writeFile(join(directory, 'dist/package.json'), '[]\n', 'utf8');
    return;
  }
  await writePackageManifest(directory, {
    main: 'index.js',
    name: policy.vendorName,
    version: vendor === 'mismatched' ? '99.0.0' : policy.vendorVersion,
  });
  await writeFile(join(directory, 'index.js'), 'export {};\n', 'utf8');
};

export const bridgePackage = async (
  policy: BridgePackagePolicy,
  mutation: BridgePackageMutation = {},
): Promise<BridgeFixture> => {
  const fixtureParent =
    mutation.ancestorPackage === undefined
      ? undefined
      : await mkdtemp(join(tmpdir(), 'revo-bridge-package-ancestor-'));
  const fixtureRoot = await mkdtemp(join(fixtureParent ?? tmpdir(), 'revo-bridge-package-'));
  const consumerDirectory = join(fixtureRoot, 'consumer');
  const consumerNodeModules = join(consumerDirectory, 'node_modules');
  const bridgeDirectory = packageDirectory(consumerNodeModules, policy.bridgeName);
  const anchorPath = join(consumerDirectory, 'resolver-anchor.mjs');
  await mkdir(consumerDirectory, { recursive: true });
  await writeFile(anchorPath, 'export {};\n', 'utf8');

  if ((mutation.manifest ?? 'valid') !== 'missing') {
    await mkdir(bridgeDirectory, { recursive: true });
    if (mutation.manifest === 'invalid') {
      await writeFile(join(bridgeDirectory, 'package.json'), '{not-json', 'utf8');
    } else {
      const manifest = {
        bin: mutation.bin ?? { [policy.binName]: 'dist/index.js' },
        dependencies: {
          [policy.vendorName]: mutation.dependencyRange ?? policy.vendorDependencyRange,
        },
        exports: { './package.json': './package.json' },
        name: mutation.bridgeName ?? policy.bridgeName,
        version: mutation.bridgeVersion ?? policy.bridgeVersion,
      };
      if (mutation.manifest === 'escape') {
        const escapedManifest = join(fixtureRoot, 'escaped-package.json');
        await writeFile(escapedManifest, `${JSON.stringify(manifest)}\n`, 'utf8');
        await symlink(escapedManifest, join(bridgeDirectory, 'package.json'));
      } else {
        await writePackageManifest(bridgeDirectory, manifest);
      }
    }
  }

  await writeBridgeEntrypoint(bridgeDirectory, mutation.entry ?? 'file', fixtureRoot);
  await writeVendorPackage(
    consumerNodeModules,
    bridgeDirectory,
    policy,
    mutation.vendor ?? 'nested',
  );

  if (fixtureParent !== undefined) {
    const ancestorPackage = mutation.ancestorPackage;
    if (ancestorPackage === undefined) throw new Error('Expected an ancestor package policy.');
    const ancestorNodeModules = join(fixtureParent, 'node_modules');
    const ancestorBridge = packageDirectory(ancestorNodeModules, ancestorPackage.bridgeName);
    await writePackageManifest(ancestorBridge, {
      bin: { [ancestorPackage.binName]: 'dist/index.js' },
      dependencies: {
        [ancestorPackage.vendorName]: ancestorPackage.vendorDependencyRange,
      },
      exports: { './package.json': './package.json' },
      name: ancestorPackage.bridgeName,
      version: ancestorPackage.bridgeVersion,
    });
    await writeBridgeEntrypoint(ancestorBridge, 'file', fixtureParent);
    await writeVendorPackage(ancestorNodeModules, ancestorBridge, ancestorPackage, 'nested');
  }

  return {
    anchor: pathToFileURL(anchorPath).href,
    dispose: async () => rm(fixtureParent ?? fixtureRoot, { force: true, recursive: true }),
    expectedEntrypoint: join(bridgeDirectory, 'dist/index.js'),
  };
};
