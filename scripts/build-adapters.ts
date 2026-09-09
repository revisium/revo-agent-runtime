import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { build } from 'esbuild';

import { claudeProviderPolicy } from '../src/providers/claude/definition.js';
import { codexProviderPolicy } from '../src/providers/codex/definition.js';

const require = createRequire(import.meta.url);
const outputDirectory = join(process.cwd(), 'adapters');
const policies = [codexProviderPolicy, claudeProviderPolicy];
const licenses = new Map<string, string>();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const readManifest = (path: string): Record<string, unknown> => {
  const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(isRecord(manifest), 'Expected a package manifest.');
  return manifest;
};

const collectLicense = (file: string): void => {
  let directory = dirname(file);
  while (dirname(directory) !== directory) {
    let manifest;
    try {
      manifest = readManifest(join(directory, 'package.json'));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (typeof manifest?.name !== 'string' || typeof manifest.version !== 'string') {
      directory = dirname(directory);
      continue;
    }
    const key = `${manifest.name}@${manifest.version}`;
    if (licenses.has(key)) return;
    for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
      try {
        licenses.set(key, readFileSync(join(directory, name), 'utf8'));
        return;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    throw new Error(`Missing license for bundled dependency ${key}.`);
  }
  throw new Error(`Cannot identify bundled dependency ${file}.`);
};

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
const results = await Promise.all(
  policies.map(async (policy) => {
    const name = policy.bridge.bridgeName;
    const manifestPath = require.resolve(`${name}/package.json`);
    const manifest = readManifest(manifestPath);
    assert.equal(manifest.version, policy.version, `Unexpected adapter version for ${name}.`);
    const binName = policy.bridge.binName;
    assert.ok(isRecord(manifest.bin));
    const entrypoint = manifest.bin[binName];
    assert.ok(typeof entrypoint === 'string');
    return build({
      entryPoints: [join(dirname(manifestPath), entrypoint)],
      outfile: join(outputDirectory, `${binName}.mjs`),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      legalComments: 'inline',
      metafile: true,
      banner: {
        js: "import { createRequire as adapterRequire } from 'node:module'; const require = adapterRequire(import.meta.url);",
      },
    });
  }),
);
for (const result of results)
  for (const file of Object.keys(result.metafile.inputs)) collectLicense(file);
writeFileSync(
  join(outputDirectory, 'NOTICE.txt'),
  [...licenses.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, license]) => `${name}\n\n${license}`)
    .join('\n\n---\n\n'),
);
