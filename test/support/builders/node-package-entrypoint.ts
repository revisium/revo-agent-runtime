import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { NodePackageEntrypointPolicy } from '../../../src/discovery/platform.js';

type EntrypointMutation =
  | 'absolute_bin'
  | 'directory'
  | 'different_bin'
  | 'escape'
  | 'manifest_array'
  | 'missing'
  | 'missing_bin'
  | 'missing_declared_bin'
  | 'number_bin'
  | 'no_shebang'
  | 'valid';

interface NodePackageEntrypointFixture {
  readonly entrypoint: string;
  readonly packageBin: string;
  readonly dispose: () => Promise<void>;
}

interface NodePackageEntrypointOptions {
  readonly versionDelayMs?: number;
  readonly versionOutput?: string;
}

export const nodePackageEntrypoint = async (
  policy: NodePackageEntrypointPolicy,
  mutation: EntrypointMutation = 'valid',
  options: NodePackageEntrypointOptions = {},
): Promise<NodePackageEntrypointFixture> => {
  const directory = await mkdtemp(join(tmpdir(), 'revo-node-package-entrypoint-'));
  const packageDirectory = join(directory, 'node_modules', ...policy.packageName.split('/'));
  const declaredBin =
    mutation === 'missing_declared_bin'
      ? 'bin/missing.js'
      : mutation === 'absolute_bin'
        ? join(packageDirectory, 'bin', 'agent.js')
        : 'bin/agent.js';
  const packageBin = join(
    packageDirectory,
    'bin',
    mutation === 'different_bin' ? 'other.js' : mutation === 'directory' ? '.' : 'agent.js',
  );
  const entrypoint = mutation === 'escape' ? join(directory, 'escaped.js') : packageBin;
  await mkdir(dirname(entrypoint), { recursive: true });
  if (mutation === 'directory') await mkdir(entrypoint, { recursive: true });
  if (mutation !== 'missing' && mutation !== 'directory') {
    await writeFile(
      entrypoint,
      mutation === 'no_shebang'
        ? 'module.exports = {};\n'
        : `#!/usr/bin/env node\nif (process.argv.includes('--version')) setTimeout(() => process.stdout.write(${JSON.stringify(options.versionOutput ?? '1.0.0\\n')}), ${options.versionDelayMs ?? 0});\n`,
      'utf8',
    );
    await chmod(entrypoint, 0o644);
  }
  if (mutation === 'different_bin') {
    const declaredEntrypoint = join(packageDirectory, 'bin', 'agent.js');
    await mkdir(dirname(declaredEntrypoint), { recursive: true });
    await writeFile(declaredEntrypoint, '#!/usr/bin/env node\n', 'utf8');
    await chmod(declaredEntrypoint, 0o644);
  }
  await mkdir(packageDirectory, { recursive: true });
  const manifest =
    mutation === 'manifest_array'
      ? []
      : mutation === 'missing_bin'
        ? { name: policy.packageName }
        : {
            bin: { [policy.binName]: mutation === 'number_bin' ? 1 : declaredBin },
            name: policy.packageName,
          };
  await writeFile(join(packageDirectory, 'package.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
  if (mutation === 'escape') {
    await mkdir(dirname(packageBin), { recursive: true });
    await symlink(entrypoint, packageBin);
  }

  return {
    dispose: async () => rm(directory, { force: true, recursive: true }),
    entrypoint,
    packageBin,
  };
};
