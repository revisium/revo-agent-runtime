import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { validateBridgeEvidence } from './bridge-evidence.js';
import { expectedPackedPaths } from './inventory.js';
import { packedConsumerSources } from './packed-consumer-sources.js';

interface PackFile {
  readonly path: string;
}

interface PackManifest {
  readonly filename: string;
  readonly files: readonly PackFile[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPackManifest = (value: unknown): value is PackManifest =>
  isRecord(value) &&
  typeof value.filename === 'string' &&
  Array.isArray(value.files) &&
  value.files.every((file) => isRecord(file) && typeof file.path === 'string');

const packageName = '@revisium/revo-agent-runtime';
const root = process.cwd();
const attw = join(root, 'node_modules/.bin/attw');
const publint = join(root, 'node_modules/.bin/publint');

const validateContents = async (manifest: PackManifest): Promise<void> => {
  const sourceDirectory = join(root, 'src');
  const sourceFiles = (await readdir(sourceDirectory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(sourceDirectory, join(entry.parentPath, entry.name)).split(sep).join('/'),
    );
  const paths = manifest.files.map((file) => file.path).sort();
  assert.deepEqual(
    paths,
    expectedPackedPaths(sourceFiles),
    'Packed package must contain only the declared build artifacts.',
  );
  assert.ok(
    paths.every((path) => !path.includes('fake-native') && !path.startsWith('test/')),
    'Packed package must not ship a test-only native protocol driver.',
  );
};

const validateCleanBuild = async (): Promise<void> => {
  const retiredArtifact = join(root, 'dist', 'retired-private-path.js');
  await mkdir(dirname(retiredArtifact), { recursive: true });
  await writeFile(retiredArtifact, 'throw new Error("stale build artifact");\n', 'utf8');
  execFileSync('pnpm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
  await assert.rejects(
    readFile(retiredArtifact),
    (error: unknown) => isRecord(error) && error.code === 'ENOENT',
    'A clean build must remove retired private artifacts before emitting dist.',
  );
};

const { consumerRuntime, consumerTypes } = packedConsumerSources(packageName);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'revo-agent-runtime-package-'));
const packageDirectory = join(temporaryRoot, 'package');
const consumerDirectory = join(temporaryRoot, 'consumer');
const npmCache = join(temporaryRoot, 'npm-cache');

try {
  await mkdir(packageDirectory);
  await mkdir(consumerDirectory);
  await validateCleanBuild();
  const packed = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', packageDirectory],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_cache: npmCache,
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
      },
    },
  );
  const parsed: unknown = JSON.parse(packed);
  assert.ok(Array.isArray(parsed) && parsed.length === 1, 'npm pack must create one tarball.');
  const manifest: unknown = parsed[0];
  assert.ok(isPackManifest(manifest), 'npm pack must return a valid tarball manifest.');
  await validateContents(manifest);
  await validateBridgeEvidence(root);

  const tarball = join(packageDirectory, manifest.filename);
  execFileSync(publint, ['run', tarball, '--strict', '--pack=false'], { cwd: root, stdio: 'pipe' });
  execFileSync(attw, [tarball, '--profile', 'esm-only'], { cwd: root, stdio: 'pipe' });

  await writeFile(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        devDependencies: { typescript: '7.0.2' },
      },
      undefined,
      2,
    )}\n`,
  );
  await writeFile(join(consumerDirectory, 'consumer.mjs'), consumerRuntime);
  await writeFile(join(consumerDirectory, 'consumer.ts'), consumerTypes);
  await writeFile(
    join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          strict: true,
        },
        include: ['consumer.ts'],
      },
      undefined,
      2,
    )}\n`,
  );

  execFileSync(
    'npm',
    [
      'install',
      '--cache',
      npmCache,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      tarball,
    ],
    {
      cwd: consumerDirectory,
      stdio: 'pipe',
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_cache: npmCache,
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
      },
    },
  );
  execFileSync(join(consumerDirectory, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
    cwd: consumerDirectory,
    stdio: 'pipe',
  });
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: consumerDirectory, stdio: 'pipe' });

  console.log(
    `Exact tarball validation passed (${manifest.files.length} files; ATTW, contents, ESM, types, and deep-import denial).`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
