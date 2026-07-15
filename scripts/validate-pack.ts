import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface PackFile {
  path: string;
}

interface PackManifest {
  filename: string;
  files: PackFile[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPackManifest = (value: unknown): value is PackManifest =>
  isRecord(value) &&
  typeof value.filename === 'string' &&
  Array.isArray(value.files) &&
  value.files.every((file: unknown) => isRecord(file) && typeof file.path === 'string');

const packDirectory = mkdtempSync(join(tmpdir(), 'revo-agent-runtime-pack-'));

try {
  const output = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', packDirectory],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: join(packDirectory, '.npm-cache'),
        npm_config_loglevel: 'silent',
      },
    },
  );

  const packResult: unknown = JSON.parse(output);
  assert.ok(Array.isArray(packResult) && packResult.length === 1);

  const manifest: unknown = packResult[0];
  assert.ok(isPackManifest(manifest));

  execFileSync('attw', [join(packDirectory, manifest.filename), '--profile', 'esm-only'], {
    stdio: 'inherit',
  });

  const paths = manifest.files.map((file) => file.path).sort();
  const requiredPaths = [
    'LICENSE',
    'README.md',
    'dist/index.d.ts',
    'dist/index.js',
    'package.json',
  ];

  for (const requiredPath of requiredPaths) {
    assert.ok(paths.includes(requiredPath), `Package is missing ${requiredPath}`);
  }

  const unexpectedPaths = paths.filter(
    (path) =>
      !['LICENSE', 'README.md', 'package.json'].includes(path) &&
      !/^dist\/.*\.(?:d\.ts|d\.ts\.map|js|js\.map)$/.test(path),
  );

  assert.deepEqual(unexpectedPaths, [], `Unexpected package files: ${unexpectedPaths.join(', ')}`);
  console.log(`Package content validation passed (${paths.length} files).`);
} finally {
  rmSync(packDirectory, { recursive: true, force: true });
}
