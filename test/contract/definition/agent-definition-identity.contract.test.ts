import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

import {
  createSealedAgentRegistry,
  DuplicateAgentDefinitionError,
  validateAgentDefinition,
} from '../../../src/definition/index.js';
import { agentDefinition } from '../../support/builders/agent-definition.js';
import { consumerSchemaDialect } from '../../support/builders/consumer-schema.js';
import { readAgentDefinitionGoldenVectors } from '../../support/fixtures/golden-vectors.js';

test('uses committed RFC 8785 bytes and SHA-256 digest vectors', async () => {
  const vectors = await readAgentDefinitionGoldenVectors();
  const artifact = await readFile(
    new URL('../fixtures/agent-definition-v1.golden.json', import.meta.url),
  );
  const recordedArtifactDigest = (
    await readFile(
      new URL('../fixtures/agent-definition-v1.golden.sha256', import.meta.url),
      'utf8',
    )
  ).split(' ')[0];

  expect(recordedArtifactDigest).toBe(createHash('sha256').update(artifact).digest('hex'));

  for (const vector of vectors) {
    const validated = validateAgentDefinition(vector.input);
    const canonicalBytes = Buffer.from(validated.canonicalBytes());

    expect(canonicalBytes.toString('base64'), vector.name).toBe(vector.canonicalUtf8Base64);
    expect(createHash('sha256').update(canonicalBytes).digest('hex'), vector.name).toBe(
      vector.sha256,
    );
    expect(validated.digest, vector.name).toBe(vector.sha256);
  }
});

test('owns a deeply frozen definition snapshot after validation', () => {
  const schema = {
    $schema: consumerSchemaDialect,
    properties: { nested: { type: 'string' } },
    type: 'object',
  };
  const input = { ...agentDefinition({ parameters: { schema } }), id: 'codex' };
  const validated = validateAgentDefinition(input);

  input.id = 'changed';
  schema.properties.nested = { type: 'number' };

  expect(validated.definition.id).toBe('codex');
  expect(validated.definition.parameters.schema).toEqual({
    $schema: consumerSchemaDialect,
    properties: { nested: { type: 'string' } },
    type: 'object',
  });
  expect(Object.isFrozen(validated.definition)).toBe(true);
  expect(Object.isFrozen(validated.definition.parameters.schema)).toBe(true);
  expect(Reflect.set(validated.definition, 'id', 'other')).toBe(false);
});

test('returns a fresh copy of the canonical bytes on every read', () => {
  const validated = validateAgentDefinition(agentDefinition());
  const first = validated.canonicalBytes();
  const originalFirstByte = first[0];

  first[0] = 0;

  expect(validated.canonicalBytes()[0]).toBe(originalFirstByte);
});

test('seals a deterministic exact-version registry', () => {
  const registry = createSealedAgentRegistry([
    agentDefinition({ id: 'zeta', version: '1.0.0' }),
    agentDefinition({ id: 'alpha', version: '2.0.0' }),
    agentDefinition({ id: 'alpha', version: '1.0.0' }),
  ]);

  expect(registry.list().map(({ definition }) => [definition.id, definition.version])).toEqual([
    ['alpha', '1.0.0'],
    ['alpha', '2.0.0'],
    ['zeta', '1.0.0'],
  ]);
  expect(registry.get({ id: 'alpha', version: '2.0.0' })?.definition.displayName).toBe('Codex');
  expect(registry.get({ id: 'alpha', version: '9.9.9' })).toBeUndefined();
  expect(registry.get({ id: 'alpha' })).toBeUndefined();
  expect(registry.get(null)).toBeUndefined();
  expect(registry.get({ id: 'alpha', version: '1.0.0', latest: true })).toBeUndefined();
  expect(registry.get({ id: 1, version: '1.0.0' })).toBeUndefined();
});

test('rejects duplicate exact identity before sealing the registry', () => {
  expect(() =>
    createSealedAgentRegistry([
      agentDefinition({ id: 'codex', version: '1.0.0' }),
      agentDefinition({ id: 'codex', version: '1.0.0' }),
    ]),
  ).toThrow(DuplicateAgentDefinitionError);

  try {
    createSealedAgentRegistry([
      agentDefinition({ id: 'codex', version: '1.0.0' }),
      agentDefinition({ id: 'codex', version: '1.0.0' }),
    ]);
  } catch (error: unknown) {
    if (!(error instanceof DuplicateAgentDefinitionError)) throw error;
    expect(error.firstIndex).toBe(0);
    expect(error.duplicateIndex).toBe(1);
    expect(error.agent).toEqual({ id: 'codex', version: '1.0.0' });
  }
});
