import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface LayerRecord {
  readonly name: string;
  readonly pattern: string;
  readonly dependencies: readonly string[];
}

interface LayerManifest {
  readonly schemaVersion: string;
  readonly sourceRoot: string;
  readonly rootModule: string;
  readonly layers: readonly LayerRecord[];
}

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLayerRecord = (value: unknown): value is LayerRecord =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  typeof value.pattern === 'string' &&
  Array.isArray(value.dependencies) &&
  value.dependencies.every((dependency) => typeof dependency === 'string');

const isLayerManifest = (value: unknown): value is LayerManifest =>
  isRecord(value) &&
  typeof value.schemaVersion === 'string' &&
  typeof value.sourceRoot === 'string' &&
  typeof value.rootModule === 'string' &&
  Array.isArray(value.layers) &&
  value.layers.every(isLayerRecord);

const manifestInput: unknown = JSON.parse(
  readFileSync(join(repositoryRoot, 'architecture', 'layers.json'), 'utf8'),
);
if (!isLayerManifest(manifestInput)) throw new Error('Invalid architecture layer manifest');
const manifest = manifestInput;

const sourceModules = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceModules(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
      ? [relative(repositoryRoot, path).replaceAll('\\', '/')]
      : [];
  });

const ownerNames = (modulePath: string): string[] =>
  manifest.layers
    .filter((layer) => new RegExp(layer.pattern, 'u').test(modulePath))
    .map(({ name }) => name);

describe('architecture layer manifest', () => {
  it('assigns every production module to exactly one layer', () => {
    for (const modulePath of sourceModules(join(repositoryRoot, manifest.sourceRoot))) {
      expect(ownerNames(modulePath), modulePath).toHaveLength(1);
    }
  });

  it.each([
    ['src/contracts/session/continuation/envelope.ts', 'contracts-session-envelope'],
    ['src/contracts/session/events.ts', 'contracts-session'],
    ['src/application/session/management/coordinator.ts', 'application-session-management'],
    ['src/execution/session/kernel/effect/request.ts', 'session-kernel-effects'],
    ['src/execution/session/kernel/command/public.ts', 'session-kernel-public-command'],
    ['src/execution/session/runtime/actor/port.ts', 'session-runtime-dispatch'],
    ['src/execution/session/runtime/resources/provider-sessions.ts', 'session-runtime-resources'],
    ['src/execution/session/runtime/actor/machine.ts', 'session-runtime'],
    ['src/execution/session/interpreter/driver.ts', 'session-interpreter'],
    ['src/execution/security/redaction/channel.ts', 'execution-security-redaction'],
    ['src/protocol/acp/session/adapter.ts', 'protocol-acp-session'],
    ['src/platform/node/session/primitives/identity.ts', 'platform-session-primitives'],
  ])('assigns the planned module %s to %s', (modulePath, owner) => {
    expect(ownerNames(modulePath)).toEqual([owner]);
  });

  it('contains valid, uniquely named dependency records', () => {
    const names = manifest.layers.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
    expect(manifest.schemaVersion).toBe('revo-agent-runtime-layers/v1');
    expect(manifest.rootModule).toBe('src/index.ts');

    for (const layer of manifest.layers) {
      expect(() => new RegExp(layer.pattern, 'u'), layer.name).not.toThrow();
      expect(
        layer.dependencies.every((dependency) => names.includes(dependency)),
        layer.name,
      ).toBe(true);
    }
  });

  it('keeps private session mechanics behind public boundaries', () => {
    const layer = (name: string): LayerRecord => {
      const record = manifest.layers.find((candidate) => candidate.name === name);
      if (record === undefined) throw new Error(`Missing architecture layer: ${name}`);
      return record;
    };

    expect(layer('contracts-session').dependencies).not.toContain('contracts-session-envelope');
    expect(layer('protocol-acp-session').dependencies).toContain('protocol-session');
    expect(layer('protocol-acp-session').dependencies).not.toContain('contracts-session');
    expect(layer('root').dependencies).not.toContain('contracts-session-envelope');
    expect(layer('root').dependencies).not.toContain('session-kernel');
    expect(layer('root').dependencies).not.toContain('session-runtime');
    expect(layer('root').dependencies).not.toContain('session-interpreter');
  });
});
