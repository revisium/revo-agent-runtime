import { expect, test } from 'vitest';

import { ManagedSessionRegistry } from '../../../../../src/application/session/management/registry.js';
import { resolveAgentSessionManagerLimits } from '../../../../../src/application/session/policy/limits/resolve.js';
import type {
  AgentSession,
  AgentSessionSnapshot,
  AgentSessionTerminalRecord,
} from '../../../../../src/contracts/session.js';
import type { SessionCommandRuntime } from '../../../../../src/execution/session/runtime/actor/port.js';

const pin = { agentId: 'fake', agentVersion: '1', definitionDigest: 'digest' } as const;

const snapshot = (
  sessionId: string,
  status: AgentSessionSnapshot['status'] = 'idle',
): AgentSessionSnapshot => ({
  acceptedAt: '2026-09-05T00:00:00.000Z',
  outputDirectory: '/output',
  pendingInteractions: [],
  pin,
  sessionId,
  status,
});

const terminal = (
  sessionId: string,
  status: 'cancelled' | 'closed' = 'closed',
): AgentSessionTerminalRecord => ({
  acceptedAt: '2026-09-05T00:00:00.000Z',
  cleanup: 'confirmed',
  finishedAt: '2026-09-05T00:01:00.000Z',
  pin,
  sessionId,
  status,
});

const runtime = (
  inspected: AgentSessionSnapshot | undefined,
  completed?: AgentSessionTerminalRecord,
): SessionCommandRuntime => ({
  dispatch: () => ({ state: 'accepted' }),
  inspect: () => inspected,
  registerCall: async () => new Promise<never>(() => undefined),
  terminal: () => completed,
  whenQuiescent: async () => undefined,
});

const handle = { sessionId: 'dlg_one' } as AgentSession;

const registry = (overrides: Parameters<typeof resolveAgentSessionManagerLimits>[0] = {}) =>
  new ManagedSessionRegistry(resolveAgentSessionManagerLimits(overrides));

test('registry exposes active handles, runtimes, snapshots, and exact filters', () => {
  const subject = registry();
  const active = runtime(snapshot('dlg_one'));

  expect(subject.claimFresh('dlg_one')).toBe(1);
  subject.register('dlg_one', 1, active);
  subject.attach('dlg_one', handle);
  subject.attach('dlg_missing', handle);

  expect(subject.get('dlg_one')).toBe(handle);
  expect(subject.runtime('dlg_one')).toBe(active);
  expect(subject.inspect('dlg_one')).toEqual(snapshot('dlg_one'));
  expect(subject.list()).toEqual([snapshot('dlg_one')]);
  expect(subject.list({ sessionId: 'other' })).toEqual([]);
  expect(subject.list({ agent: { id: 'other', version: '1' } })).toEqual([]);
  expect(subject.list({ agent: { id: 'fake', version: '1' } })).toHaveLength(1);
  expect(subject.list({ statuses: ['running'] })).toEqual([]);
  expect(subject.list({ statuses: ['idle'] })).toHaveLength(1);
  expect(subject.activeEntries()).toHaveLength(1);
  expect(() => subject.claimFresh('dlg_one')).toThrowError(
    expect.objectContaining({
      fault: expect.objectContaining({ code: 'revo.agent.session_duplicate' }),
    }),
  );
});

test('registry reconciles terminal records, filters them, and evicts the oldest', () => {
  const subject = registry({ maxCompletedSessions: 1 });
  subject.register('dlg_one', 1, runtime(snapshot('dlg_one'), terminal('dlg_one')));

  expect(subject.terminal('dlg_one')).toEqual(terminal('dlg_one'));
  expect(subject.get('dlg_one')).toBeUndefined();
  expect(subject.listTerminal({ statuses: ['closed'] })).toHaveLength(1);
  expect(subject.listTerminal({ statuses: ['cancelled'] })).toEqual([]);
  expect(subject.listTerminal({ sessionId: 'other' })).toEqual([]);
  expect(subject.listTerminal({ agent: { id: 'other', version: '1' } })).toEqual([]);

  subject.register('dlg_two', 1, runtime(snapshot('dlg_two'), terminal('dlg_two', 'cancelled')));
  subject.reconcileAll();
  expect(subject.terminal('dlg_one')).toBeUndefined();
  expect(subject.terminal('dlg_two')).toEqual(terminal('dlg_two', 'cancelled'));
  expect(subject.listTerminal({ agent: { id: 'fake', version: '1' } })).toHaveLength(1);
});

test('registry enforces active, opening, and identity capacities', () => {
  const activeLimited = registry({ maxActiveSessions: 1 });
  activeLimited.register('dlg_one', 1, runtime(snapshot('dlg_one')));
  expect(() => activeLimited.claimFresh('dlg_two')).toThrowError(
    expect.objectContaining({
      fault: expect.objectContaining({ code: 'revo.agent.session_capacity' }),
    }),
  );

  const openingLimited = registry({ maxActiveSessions: 2, maxOpeningSessions: 1 });
  openingLimited.register('dlg_one', 1, runtime(snapshot('dlg_one', 'opening')));
  expect(() => openingLimited.claimFresh('dlg_two')).toThrowError(
    expect.objectContaining({
      fault: expect.objectContaining({ code: 'revo.agent.session_capacity' }),
    }),
  );

  const identityLimited = registry({
    maxActiveSessions: 28,
    maxOpeningSessions: 4,
    maxSessionIdentities: 32,
  });
  for (let index = 0; index < 32; index += 1) {
    const sessionId = `dlg_identity_${index}`;
    identityLimited.register(sessionId, 1, runtime(snapshot(sessionId), terminal(sessionId)));
    identityLimited.reconcile(sessionId);
  }
  identityLimited.reconcile('dlg_missing');
  expect(() => identityLimited.claimFresh('dlg_identity_overflow')).toThrowError(
    expect.objectContaining({
      fault: expect.objectContaining({ code: 'revo.agent.session_identity_capacity' }),
    }),
  );
});

test('registry consumes resume tokens once and accepts only matching hibernated records', () => {
  const active = registry();
  active.register('dlg_active', 1, runtime(snapshot('dlg_active')));
  expect(() => active.claimResume('dlg_active', 'tok_active')).toThrowError(
    expect.objectContaining({
      fault: expect.objectContaining({ code: 'revo.agent.session_duplicate' }),
    }),
  );

  const consumed = registry();
  expect(consumed.claimResume('dlg_one', 'tok_used')).toBe(1);
  expect(() => consumed.claimResume('dlg_two', 'tok_used')).toThrowError(
    expect.objectContaining({
      fault: expect.objectContaining({ code: 'revo.agent.resume_token_consumed' }),
    }),
  );

  const mismatch = registry();
  mismatch.register('dlg_one', 1, runtime(snapshot('dlg_one'), terminal('dlg_one')));
  mismatch.reconcileAll();
  expect(() => mismatch.claimResume('dlg_one', 'tok_wrong')).toThrowError(
    expect.objectContaining({
      fault: expect.objectContaining({ code: 'revo.agent.session_duplicate' }),
    }),
  );

  const matching = registry();
  const resumeToken = {
    cursor: { eventId: 'event', sequence: 1, streamId: 'stream' },
    eligibility: 'hibernated' as const,
    payload: 'payload',
    pin,
    resumeTokenId: 'tok_match',
    schemaVersion: 'agent-session-resume-token/v1' as const,
    sessionId: 'dlg_one',
    sha256: 'digest',
  };
  matching.register(
    'dlg_one',
    1,
    runtime(snapshot('dlg_one'), {
      acceptedAt: '2026-09-05T00:00:00.000Z',
      cleanup: 'confirmed',
      finishedAt: '2026-09-05T00:01:00.000Z',
      pin,
      resumeToken,
      sessionId: 'dlg_one',
      status: 'hibernated',
    }),
  );
  matching.reconcileAll();
  expect(matching.claimResume('dlg_one', 'tok_match')).toBe(2);
  matching.register('dlg_one', 2, runtime(snapshot('dlg_one')));
  expect(matching.terminal('dlg_one')).toBeUndefined();
});
