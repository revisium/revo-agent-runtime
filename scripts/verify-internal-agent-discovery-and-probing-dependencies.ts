import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const FINAL_WORKSPACE =
  'allowBuilds:\n  esbuild: false # tsx uses the platform package; no install script is required\n';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

type Ajv2020Constructor = new (options: { readonly strict: boolean }) => {
  validate(schema: unknown, data: unknown): boolean;
};

const isAjv2020Constructor = (value: unknown): value is Ajv2020Constructor =>
  typeof value === 'function';

const createAjv2020 = (): InstanceType<Ajv2020Constructor> => {
  const candidate: unknown = Ajv2020;
  if (!isAjv2020Constructor(candidate)) throw new Error('Ajv 2020 constructor is unavailable.');

  return new candidate({ strict: true });
};

const readJsonRecord = async (url: URL): Promise<Record<string, unknown>> => {
  const value: unknown = JSON.parse(await readFile(url, 'utf8'));
  assert.ok(isRecord(value), `Expected a JSON object in ${url.pathname}.`);
  return value;
};

const assertFinalDependencyBaseline = (
  workspace: string,
  lock: string,
  packageManifest: Record<string, unknown>,
): void => {
  assert.equal(
    workspace,
    FINAL_WORKSPACE,
    'Workspace must match the final internal agent discovery and probing dependency baseline.',
  );
  assert.equal(
    workspace.includes('ajv>fast-uri'),
    false,
    'Workspace must not override Ajv fast-uri.',
  );
  assert.equal(
    workspace.includes('minimumReleaseAgeExclude'),
    false,
    'Workspace must not retain the expired release-age exception.',
  );
  assert.equal(workspace.includes('trustPolicy'), false, 'Workspace must not trust the lockfile.');
  assert.equal(
    /(?:^|\n)minimumReleaseAge:\s*0\s*(?:\n|$)/u.test(workspace),
    false,
    'Workspace must not disable minimum release age.',
  );
  assert.equal(
    lock.includes('fast-uri@3.1.2'),
    false,
    'Lockfile must not select vulnerable fast-uri@3.1.2.',
  );
  assert.equal(
    (lock.match(/^  fast-uri@3\.1\.4:\n    resolution:/gmu) ?? []).length,
    1,
    'Lockfile must contain exactly one fast-uri@3.1.4 package stanza.',
  );

  assert.ok(isRecord(packageManifest.dependencies), 'Package dependencies must be an object.');
  assert.equal(packageManifest.dependencies.zod, '4.4.3');
  assert.equal(packageManifest.dependencies.ajv, '8.20.0');
  assert.equal(packageManifest.dependencies.canonicalize, '3.0.0');
};

const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
const packageManifest = await readJsonRecord(new URL('../package.json', import.meta.url));
assertFinalDependencyBaseline(workspace, lock, packageManifest);

const ajvRequire = createRequire(import.meta.resolve('ajv'));
const fastUriEntry = pathToFileURL(ajvRequire.resolve('fast-uri'));
const manifestUrls = {
  zod: new URL('package.json', import.meta.resolve('zod')),
  ajv: new URL('../package.json', import.meta.resolve('ajv')),
  canonicalize: new URL('../package.json', import.meta.resolve('canonicalize')),
  'fast-uri': new URL('package.json', fastUriEntry),
} as const;

const expected = [
  [
    'zod',
    '4.4.3',
    'MIT',
    'sha512-ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ==',
  ],
  [
    'ajv',
    '8.20.0',
    'MIT',
    'sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==',
  ],
  [
    'canonicalize',
    '3.0.0',
    'Apache-2.0',
    'sha512-yYLfHyDMIXRyRqsKBRLX023riFLpXY2YOfdtqKXZRZy9qsfOJ9U+4F9YZL7MEzL5+ziN2x2nlBvY/Voi3EBljA==',
  ],
  [
    'fast-uri',
    '3.1.4',
    'BSD-3-Clause',
    'sha512-8JnbkQ4juDyvYs4mgFGQqg4yCYtFDtUtmp2QIQq11ZZe5CFQ5wcqm1rqDgAh/QdMySuBnPzMUiJUNZG5N/AiQw==',
  ],
] as const;

await Promise.all(
  expected.map(async ([name, version, license, integrity]) => {
    const manifest = await readJsonRecord(manifestUrls[name]);
    assert.equal(manifest.version, version);
    assert.equal(manifest.license, license);
    const scripts = isRecord(manifest.scripts) ? manifest.scripts : {};
    assert.equal(Object.hasOwn(scripts, 'install'), false);
    assert.equal(Object.hasOwn(scripts, 'preinstall'), false);
    assert.equal(Object.hasOwn(scripts, 'postinstall'), false);
    assert.ok(lock.includes(`${name}@${version}`));
    assert.ok(lock.includes(integrity));
  }),
);

const ajvManifest = await readJsonRecord(manifestUrls.ajv);
assert.ok(isRecord(ajvManifest.dependencies));
assert.equal(ajvManifest.dependencies['fast-uri'], '^3.0.1');

const { z } = await import('zod/v4');
const { default: canonicalize } = await import('canonicalize');
assert.equal(z.strictObject({ value: z.string() }).parse({ value: 'ok' }).value, 'ok');
assert.equal(createAjv2020().validate({ type: 'string' }, 'ok'), true);
assert.equal(canonicalize({ b: 2, a: 1 }), '{"a":1,"b":2}');

console.log('Internal agent discovery and probing dependency installed-tree audit passed.');
