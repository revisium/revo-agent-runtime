import { describe, expect, test } from 'vitest';

import { resolveSessionCapabilities } from '../../../../../../src/application/session/policy/capabilities/session-support.js';
import type { AgentDefinitionSessionCapabilities } from '../../../../../../src/contracts/agent-definition.js';
import { AgentManagerError } from '../../../../../../src/contracts/manager.js';

const declared = {
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} satisfies AgentDefinitionSessionCapabilities;

const declaredWithoutResume = {
  ...declared,
  resume: 'none',
} satisfies AgentDefinitionSessionCapabilities;

describe('session capability negotiation', () => {
  test('allows a provider to downgrade optional capabilities and freezes the result', () => {
    const negotiated = resolveSessionCapabilities(declared, {
      interactions: { input: false, permission: true },
      multiTurn: true,
      resume: 'none',
      updates: { message: true, plan: false, progress: true, tool: false, usage: true },
    });

    expect(negotiated.resume).toBe('none');
    expect(Object.isFrozen(negotiated)).toBe(true);
    expect(Object.isFrozen(negotiated.updates)).toBe(true);
  });

  test.each([
    [undefined, declared],
    [declaredWithoutResume, declared],
    [declared, { ...declared, updates: { ...declared.updates, message: false } }],
    [declared, { ...declared, extra: true }],
    [declared, null],
    [declared, { ...declared, interactions: null }],
    [declared, { ...declared, interactions: { input: true } }],
    [declared, { ...declared, multiTurn: false }],
    [declared, { ...declared, resume: 'history' }],
    [declared, new Proxy(declared, {})],
  ])(
    'rejects absent support or invented/invalid negotiated capabilities',
    (supported, negotiated) => {
      expect(() => resolveSessionCapabilities(supported, negotiated)).toThrow(AgentManagerError);
    },
  );

  test.each([
    [{ ...declared, interactions: { ...declared.interactions, input: false } }, declared],
    [{ ...declared, interactions: { ...declared.interactions, permission: false } }, declared],
    [{ ...declared, updates: { ...declared.updates, plan: false } }, declared],
    [{ ...declared, updates: { ...declared.updates, progress: false } }, declared],
    [{ ...declared, updates: { ...declared.updates, tool: false } }, declared],
    [{ ...declared, updates: { ...declared.updates, usage: false } }, declared],
  ] satisfies readonly (readonly [AgentDefinitionSessionCapabilities, unknown])[])(
    'rejects an invented negotiated feature',
    (supported, negotiated) => {
      expect(() => resolveSessionCapabilities(supported, negotiated)).toThrow(AgentManagerError);
    },
  );
});
