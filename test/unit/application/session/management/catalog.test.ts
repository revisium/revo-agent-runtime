import { expect, test } from 'vitest';

import { SessionAgentCatalog } from '../../../../../src/application/session/management/catalog.js';
import { createUnavailableAgentSessions } from '../../../../../src/application/session/management/unavailable.js';
import type { AgentDescriptor } from '../../../../../src/index.js';

const sessionDescriptor: AgentDescriptor = {
  agent: { id: 'session', version: '1' },
  capabilities: {
    cancellation: true,
    session: {
      interactions: { input: true, permission: true },
      multiTurn: true,
      resume: 'none',
      updates: { message: true, plan: true, progress: false, tool: true, usage: true },
    },
    structuredResult: true,
    usage: true,
  },
  definitionDigest: 'session-digest',
  displayName: 'Session agent',
};

const invocationDescriptor: AgentDescriptor = {
  agent: { id: 'invocation', version: '1' },
  capabilities: { cancellation: true, structuredResult: true, usage: false },
  definitionDigest: 'invocation-digest',
  displayName: 'Invocation agent',
};

test('session catalog filters agents and enforces exact identity and pinning', () => {
  const catalog = new SessionAgentCatalog([invocationDescriptor, sessionDescriptor]);

  expect(catalog.list()).toEqual([sessionDescriptor]);
  expect(catalog.require(sessionDescriptor.agent)).toBe(sessionDescriptor);
  expect(
    catalog.requirePin({
      agentId: 'session',
      agentVersion: '1',
      definitionDigest: 'session-digest',
    }),
  ).toBe(sessionDescriptor);
  expect(() => catalog.require({ id: 'missing', version: '1' })).toThrowError(
    expect.objectContaining({
      fault: expect.objectContaining({ code: 'revo.agent.agent_unknown' }),
    }),
  );
  expect(() => catalog.require(invocationDescriptor.agent)).toThrowError(
    expect.objectContaining({
      fault: expect.objectContaining({ code: 'revo.agent.session_unsupported' }),
    }),
  );
  expect(() =>
    catalog.requirePin({
      agentId: 'session',
      agentVersion: '1',
      definitionDigest: 'stale',
    }),
  ).toThrowError(
    expect.objectContaining({
      fault: expect.objectContaining({ code: 'revo.agent.continuation_pin_mismatch' }),
    }),
  );
});

test('unconfigured session facet exposes discovery and fails every mutation closed', async () => {
  const sessions = createUnavailableAgentSessions([invocationDescriptor, sessionDescriptor]);

  expect(sessions.listAgents()).toEqual([sessionDescriptor]);
  expect(sessions.get('dlg_missing')).toBeUndefined();
  expect(sessions.inspect('dlg_missing')).toBeUndefined();
  expect(sessions.list()).toEqual([]);
  expect(sessions.getTerminal('dlg_missing')).toBeUndefined();
  expect(sessions.listTerminal()).toEqual([]);
  await expect(sessions.cancel('dlg_missing')).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_state_unavailable' },
  });
  await expect(sessions.open(undefined as never)).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_state_unavailable' },
  });
  await expect(sessions.respond('dlg_missing', undefined as never)).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_state_unavailable' },
  });
  await expect(sessions.resume(undefined as never)).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_state_unavailable' },
  });
});
