import { expect, test } from 'vitest';

import { validateManagerOptions } from '../../../../src/runtime/definition/index.js';
import { SealedAgentRegistry } from '../../../../src/runtime/registry/index.js';
import type { AgentDefinitionInput, AgentDescriptor } from '../../../../src/runtime/spec/index.js';
import { buildAgentDefinition } from '../../../support/definition/build-agent-definition.js';

const definition = (
  id: string,
  version: string,
  displayName = `${id}@${version}`,
  description?: string,
): AgentDefinitionInput =>
  buildAgentDefinition({
    id,
    version,
    displayName,
    ...(description === undefined ? {} : { description }),
  });

const createRegistry = (definitions: readonly AgentDefinitionInput[]) => {
  const construction = validateManagerOptions({ definitions });

  return {
    construction,
    registry: SealedAgentRegistry.create(construction.definitions),
  };
};

const descriptor = (
  id: string,
  version: string,
  definitionDigest: string,
  displayName: string,
): AgentDescriptor => ({
  agent: { id, version },
  definitionDigest,
  displayName,
  capabilities: { cancellation: true, structuredResult: true, usage: true },
});

const digestFor = (
  definitions: ReturnType<typeof validateManagerOptions>['definitions'],
  id: string,
  version: string,
): string => {
  const validated = definitions.find(
    (candidate) => candidate.definition.id === id && candidate.definition.version === version,
  );
  if (validated === undefined) throw new Error(`Missing ${id}@${version}.`);
  return validated.definitionDigest;
};

test('coexists with multiple versions and returns only exact nested-map matches', () => {
  const { registry } = createRegistry([
    definition('agent', '1.0.0'),
    definition('agent', '2.0.0'),
    definition('other', '1.0.0'),
  ]);

  expect(registry.getAgent({ id: 'agent', version: '1.0.0' })?.agent).toEqual({
    id: 'agent',
    version: '1.0.0',
  });
  expect(registry.getAgent({ id: 'agent', version: '2.0.0' })?.agent).toEqual({
    id: 'agent',
    version: '2.0.0',
  });
  expect(registry.getAgent({ id: 'agent', version: '3.0.0' })).toBeUndefined();
  expect(registry.getAgent({ id: 'other', version: '2.0.0' })).toBeUndefined();
});

test('orders descriptors by unsigned UTF-8 id then version with prefixes first', () => {
  const { construction, registry } = createRegistry([
    definition('\u{10000}', '1.0.0'),
    definition('ab', '1.0.0'),
    definition('a', '2.0.0'),
    definition('\uE000', '1.0.0'),
    definition('a', '1.0.0-a'),
    definition('a', '1.0.0'),
  ]);
  expect(registry.listAgents()).toEqual([
    descriptor('a', '1.0.0', digestFor(construction.definitions, 'a', '1.0.0'), 'a@1.0.0'),
    descriptor('a', '1.0.0-a', digestFor(construction.definitions, 'a', '1.0.0-a'), 'a@1.0.0-a'),
    descriptor('a', '2.0.0', digestFor(construction.definitions, 'a', '2.0.0'), 'a@2.0.0'),
    descriptor('ab', '1.0.0', digestFor(construction.definitions, 'ab', '1.0.0'), 'ab@1.0.0'),
    descriptor(
      '\uE000',
      '1.0.0',
      digestFor(construction.definitions, '\uE000', '1.0.0'),
      '\uE000@1.0.0',
    ),
    descriptor(
      '\u{10000}',
      '1.0.0',
      digestFor(construction.definitions, '\u{10000}', '1.0.0'),
      '\u{10000}@1.0.0',
    ),
  ]);
});

test('keeps delimiter-collision references distinct without composite identity keys', () => {
  const { registry } = createRegistry([definition('a:b', 'c'), definition('a', 'b:c')]);

  expect(registry.getAgent({ id: 'a:b', version: 'c' })?.agent).toEqual({
    id: 'a:b',
    version: 'c',
  });
  expect(registry.getAgent({ id: 'a', version: 'b:c' })?.agent).toEqual({
    id: 'a',
    version: 'b:c',
  });
});

test('rejects malformed, extra, inherited, accessor, and normalized references', () => {
  const { registry } = createRegistry([definition('Caf\u00E9', '1.0.0')]);
  const inherited: object = {};
  Object.setPrototypeOf(inherited, { id: 'Caf\u00E9', version: '1.0.0' });
  const accessor = Object.defineProperties(
    {},
    {
      id: { enumerable: true, get: () => 'Caf\u00E9' },
      version: { enumerable: true, get: () => '1.0.0' },
    },
  );

  for (const ref of [
    undefined,
    null,
    [],
    {},
    { id: 'Caf\u00E9' },
    { version: '1.0.0' },
    { id: 'Caf\u00E9', version: '1.0.0', extra: true },
    { id: 'Caf\u00E9', version: 1 },
    inherited,
    accessor,
    { id: ' Caf\u00E9', version: '1.0.0' },
    { id: 'caf\u00E9', version: '1.0.0' },
    { id: 'Cafe\u0301', version: '1.0.0' },
  ]) {
    expect(registry.getAgent(ref)).toBeUndefined();
  }
});

test('exposes only frozen descriptors detached from caller refs and list mutation', () => {
  const { construction, registry } = createRegistry([
    definition('agent', '1.0.0', 'Agent', 'A description'),
  ]);
  const validated = construction.definitions[0];
  if (validated === undefined) throw new Error('Expected a validated definition.');
  const ref = { id: 'agent', version: '1.0.0' };
  const agents = registry.listAgents();
  const listed = registry.getAgent(ref);
  if (listed === undefined) throw new Error('Expected a registry descriptor.');

  expect(listed).toEqual({
    agent: { id: 'agent', version: '1.0.0' },
    definitionDigest: validated.definitionDigest,
    displayName: 'Agent',
    description: 'A description',
    capabilities: { cancellation: true, structuredResult: true, usage: true },
  });
  expect(Object.keys(listed).sort()).toEqual([
    'agent',
    'capabilities',
    'definitionDigest',
    'description',
    'displayName',
  ]);
  expect('definition' in listed).toBe(false);
  expect(Object.isFrozen(registry)).toBe(true);
  expect(Object.isFrozen(agents)).toBe(true);
  expect(Object.isFrozen(listed)).toBe(true);
  expect(Object.isFrozen(listed.agent)).toBe(true);
  expect(Object.isFrozen(listed.capabilities)).toBe(true);

  expect(Reflect.set(ref, 'id', 'changed')).toBe(true);
  expect(Reflect.set(agents, 0, {})).toBe(false);
  expect(Reflect.set(listed.agent, 'id', 'changed')).toBe(false);
  expect(Reflect.set(listed.capabilities, 'cancellation', false)).toBe(false);
  expect(registry.listAgents()).toEqual([listed]);
  expect(registry.getAgent({ id: 'agent', version: '1.0.0' })).toEqual(listed);
});

test('associates each descriptor digest with its exact validated definition and exposes no mutation APIs', () => {
  const { construction, registry } = createRegistry([
    definition('agent', '1.0.0'),
    definition('agent', '2.0.0'),
  ]);

  for (const validated of construction.definitions) {
    expect(
      registry.getAgent({
        id: validated.definition.id,
        version: validated.definition.version,
      })?.definitionDigest,
    ).toBe(validated.definitionDigest);
  }
  for (const name of [
    'register',
    'unregister',
    'replaceDefinitions',
    'getLatest',
    'getCompatible',
    'getFallback',
    'clearCache',
    'probe',
    'probeAgent',
  ]) {
    expect(Reflect.has(registry, name)).toBe(false);
  }
});
