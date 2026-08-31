import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface AdjacentNodePackageFixture {
  readonly directory: string;
  readonly entrypoint: string;
  readonly launcher: string;
  readonly node: string;
  readonly dispose: () => Promise<void>;
}

type AdjacentNodePackageMutation = 'collision' | 'escaped_node' | 'missing_index' | 'valid';

export const adjacentNodePackage = async (
  mutation: AdjacentNodePackageMutation = 'valid',
  versionOutput = '2026.08.11-e8db854\n',
  nodeName = 'node',
): Promise<AdjacentNodePackageFixture> => {
  const directory = await mkdtemp(join(tmpdir(), 'revo-adjacent-node-package-'));
  const launcher = join(directory, mutation === 'collision' ? 'agent' : 'cursor-agent');
  const node = join(directory, nodeName);
  const entrypoint = join(directory, 'index.js');
  const escapedDirectory =
    mutation === 'escaped_node'
      ? await mkdtemp(join(tmpdir(), 'revo-adjacent-node-package-escaped-'))
      : undefined;
  await mkdir(directory, { recursive: true });
  await writeFile(launcher, '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(launcher, 0o755);
  if (mutation === 'escaped_node') {
    if (escapedDirectory === undefined) throw new Error('Expected escaped package directory.');
    const escapedNode = join(escapedDirectory, 'node');
    await writeFile(escapedNode, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(escapedNode, 0o755);
    await symlink(escapedNode, node);
  } else {
    await writeFile(
      node,
      `#!${process.execPath}\nconst { spawnSync } = require('node:child_process');\nconst result = spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit' });\nprocess.exitCode = result.status ?? 1;\n`,
      'utf8',
    );
    await chmod(node, 0o755);
  }
  if (mutation !== 'missing_index') {
    await writeFile(
      entrypoint,
      `if (process.argv.includes('--version')) process.stdout.write(${JSON.stringify(versionOutput)});\n`,
      'utf8',
    );
    await chmod(entrypoint, 0o644);
  }
  return {
    directory,
    dispose: async () =>
      Promise.all([
        rm(directory, { force: true, recursive: true }),
        ...(escapedDirectory === undefined
          ? []
          : [rm(escapedDirectory, { force: true, recursive: true })]),
      ]).then(() => undefined),
    entrypoint,
    launcher,
    node,
  };
};
