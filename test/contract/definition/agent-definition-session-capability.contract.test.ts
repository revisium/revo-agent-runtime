import { expect, test } from 'vitest';

import {
  DefinitionValidationError,
  validateAgentDefinition,
} from '../../../src/definition/index.js';
import { agentDefinition } from '../../support/builders/agent-definition.js';

const sessionCapability = {
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;

test('validates, owns, and digests an optional session capability', () => {
  const input = agentDefinition({
    capabilities: {
      cancellation: true,
      session: sessionCapability,
      structuredResult: true,
      usage: true,
    },
  });
  const validated = validateAgentDefinition(input);
  const withoutSession = validateAgentDefinition(agentDefinition());

  expect(validated.definition.capabilities.session).toEqual(sessionCapability);
  expect(Object.isFrozen(validated.definition.capabilities.session)).toBe(true);
  expect(validated.digest).toBe('76c32d2e9bc42c1415706183b548b2b3056e3098c20e7f7e33ee733fe56d3b26');
  expect(validated.digest).not.toBe(withoutSession.digest);
  expect(withoutSession.definition.capabilities.session).toBeUndefined();
});

test('accepts a multi-turn provider without native resume or optional updates', () => {
  const validated = validateAgentDefinition({
    ...agentDefinition(),
    capabilities: {
      cancellation: true,
      session: {
        interactions: { input: false, permission: false },
        multiTurn: true,
        resume: 'none',
        updates: { message: true, plan: false, progress: false, tool: false, usage: false },
      },
      structuredResult: true,
      usage: true,
    },
  });

  expect(validated.definition.capabilities.session?.resume).toBe('none');
});

test.each([
  { ...sessionCapability, multiTurn: false },
  { ...sessionCapability, resume: 'history' },
  { ...sessionCapability, interactions: { permission: true } },
  { ...sessionCapability, updates: { ...sessionCapability.updates, message: false } },
  { ...sessionCapability, updates: { ...sessionCapability.updates, unknown: true } },
])('rejects malformed session capabilities', (session) => {
  expect(() =>
    validateAgentDefinition({
      ...agentDefinition(),
      capabilities: {
        cancellation: true,
        session,
        structuredResult: true,
        usage: true,
      },
    }),
  ).toThrow(DefinitionValidationError);
});
