import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
assert.equal(
  workspace.includes('ajv>fast-uri'),
  false,
  'Vulnerable ajv>fast-uri override must be removed before dependency resolution.',
);
assert.equal(
  /(?:^|\n)overrides:\s*(?:\n|$)/u.test(workspace),
  false,
  'Workspace must retain its baseline without overrides.',
);
assert.equal(
  workspace.includes('minimumReleaseAgeExclude: [fast-uri@3.1.4]'),
  true,
  'Task 1 requires only the approved temporary fast-uri@3.1.4 release-age exception.',
);
assert.equal(workspace.includes('trustPolicy:'), false, 'Task 1 must not trust lockfile policy.');
assert.equal(
  /(?:^|\n)minimumReleaseAge:\s*0\s*(?:\n|$)/u.test(workspace),
  false,
  'Task 1 must not disable minimumReleaseAge.',
);
assert.equal(
  lock.includes('fast-uri@3.1.2'),
  false,
  'Lockfile must not select vulnerable fast-uri@3.1.2.',
);
assert.ok(lock.includes('fast-uri@3.1.4'), 'Lockfile must select safe fast-uri@3.1.4.');

const ajvRequire = createRequire(import.meta.resolve('ajv'));
const fastUriEntry = pathToFileURL(ajvRequire.resolve('fast-uri'));

const manifestUrls = {
  zod: new URL('package.json', import.meta.resolve('zod')),
  ajv: new URL('../package.json', import.meta.resolve('ajv')),
  canonicalize: new URL('../package.json', import.meta.resolve('canonicalize')),
  'fast-uri': new URL('package.json', fastUriEntry),
} as const;

const readManifest = async (name: keyof typeof manifestUrls): Promise<Record<string, unknown>> => {
  const value: unknown = JSON.parse(await readFile(manifestUrls[name], 'utf8'));
  assert.ok(isRecord(value));
  return value;
};

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
    const manifest = await readManifest(name);
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

const ajvManifest = await readManifest('ajv');
assert.ok(isRecord(ajvManifest.dependencies));
assert.equal(ajvManifest.dependencies['fast-uri'], '^3.0.1');

const { z } = await import('zod/v4');
const { Ajv2020 } = await import('ajv/dist/2020.js');
const { default: canonicalize } = await import('canonicalize');
assert.equal(z.strictObject({ value: z.string() }).parse({ value: 'ok' }).value, 'ok');
assert.equal(new Ajv2020({ strict: true }).validate({ type: 'string' }, 'ok'), true);
assert.equal(canonicalize({ b: 2, a: 1 }), '{"a":1,"b":2}');
console.log('M1 dependency installed-tree audit passed.');
