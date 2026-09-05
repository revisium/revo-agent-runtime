import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import {
  createAgentManager,
  type ActiveAgentSessionSnapshot,
  type AgentSessionEvent,
} from '../../../../src/index.js';
import { fakeAcpDefinition } from '../../../support/fakes/fake-acp.js';
import { noOpActiveStateSink } from '../../../support/stories/active-state.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const fixtureDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'revo-agent-session-'));
  directories.push(directory);
  return directory;
};

test('one public manager owns a hot multi-turn session and its lifecycle', async () => {
  const directory = await fixtureDirectory();
  const events: AgentSessionEvent[] = [];
  const active = new Map<string, ActiveAgentSessionSnapshot>();
  const manager = createAgentManager({
    activeStateSink: noOpActiveStateSink,
    definitions: [fakeAcpDefinition({ mode: 'session' })],
    sessions: {
      activeStateSink: {
        remove: async ({ incarnationId, sessionId }) => {
          if (active.get(sessionId)?.incarnationId !== incarnationId) return { state: 'not_owner' };
          active.delete(sessionId);
          return { state: 'applied' };
        },
        save: async (snapshot) => {
          active.set(snapshot.sessionId, snapshot);
          return { state: 'applied' };
        },
      },
      eventSink: {
        append: async (event) => {
          events.push(event);
          return { state: 'appended' };
        },
      },
      limits: { maxActiveSessions: 2 },
    },
  });
  await manager.initialize({ invocations: [], sessions: [] });

  expect(manager.sessions.listAgents()).toHaveLength(1);
  const session = await manager.sessions.open({
    agent: { id: 'codex', version: '1.0.0' },
    output: { directory: join(directory, 'session-output') },
    parameters: {},
    permissions: {},
    sessionId: 'dlg_public_contract',
    workspace: { directory },
  });
  const first = await session.send({ prompt: 'nonce-2RD', turnId: 'trn_remember' });
  await expect(first.result()).resolves.toMatchObject({ status: 'completed' });
  const second = await session.send({ prompt: 'recall', turnId: 'trn_recall' });
  await expect(second.result()).resolves.toMatchObject({
    message: { content: 'nonce-2RD', role: 'assistant' },
    status: 'completed',
  });
  await expect(session.close()).resolves.toEqual({ state: 'closed' });
  await manager.shutdown();

  expect(active.size).toBe(0);
  expect(events.map(({ type }) => type)).toEqual([
    'session.accepted',
    'session.opened',
    'turn.started',
    'assistant.message.delta',
    'assistant.message.completed',
    'turn.completed',
    'turn.started',
    'assistant.message.delta',
    'assistant.message.completed',
    'turn.completed',
    'session.closed',
  ]);
  await expect(
    readFile(join(directory, 'session-output', 'session.json'), 'utf8'),
  ).resolves.toContain('dlg_public_contract');
});

test('manager shutdown cancels and drains an active session turn', async () => {
  const directory = await fixtureDirectory();
  const active = new Map<string, ActiveAgentSessionSnapshot>();
  const manager = createAgentManager({
    activeStateSink: noOpActiveStateSink,
    definitions: [fakeAcpDefinition({ mode: 'hang', session: true })],
    sessions: {
      activeStateSink: {
        remove: async ({ incarnationId, sessionId }) => {
          if (active.get(sessionId)?.incarnationId !== incarnationId) return { state: 'not_owner' };
          active.delete(sessionId);
          return { state: 'applied' };
        },
        save: async (snapshot) => {
          active.set(snapshot.sessionId, snapshot);
          return { state: 'applied' };
        },
      },
      eventSink: { append: async () => ({ state: 'appended' }) },
    },
  });
  await manager.initialize({ invocations: [], sessions: [] });
  const session = await manager.sessions.open({
    agent: { id: 'codex', version: '1.0.0' },
    output: { directory: join(directory, 'shutdown-output') },
    parameters: {},
    permissions: {},
    sessionId: 'dlg_shutdown_contract',
    workspace: { directory },
  });
  const controller = new AbortController();
  const cancelledTurn = await session.send(
    { prompt: 'wait', turnId: 'trn_abort' },
    { signal: controller.signal },
  );
  controller.abort();
  await expect(cancelledTurn.result()).resolves.toMatchObject({ status: 'cancelled' });
  const turn = await session.send({ prompt: 'wait again', turnId: 'trn_wait' });

  await expect(manager.shutdown('contract shutdown')).resolves.toBeUndefined();
  await expect(turn.result()).resolves.toMatchObject({ status: 'interrupted' });
  expect(active.size).toBe(0);
  expect(manager.sessions.get('dlg_shutdown_contract')).toBeUndefined();
  await expect(
    manager.sessions.open({
      agent: { id: 'codex', version: '1.0.0' },
      output: { directory: join(directory, 'after-shutdown') },
      parameters: {},
      permissions: {},
      sessionId: 'dlg_after_shutdown',
      workspace: { directory },
    }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.manager_closed' } });
});

test('structured initialization safely reconciles an orphaned session row', async () => {
  const removed: { incarnationId: string; sessionId: string }[] = [];
  const manager = createAgentManager({
    activeStateSink: noOpActiveStateSink,
    definitions: [fakeAcpDefinition({ mode: 'session' })],
    sessions: {
      activeStateSink: {
        remove: async (identity) => {
          removed.push(identity);
          return { state: 'applied' };
        },
        save: async () => ({ state: 'applied' }),
      },
      eventSink: { append: async () => ({ state: 'appended' }) },
    },
  });
  const descriptor = manager.sessions.listAgents()[0];
  if (descriptor === undefined) throw new Error('Expected a session-capable fake agent.');

  await manager.initialize({
    invocations: [],
    sessions: [
      {
        acceptedAt: '2026-09-05T00:00:00.000Z',
        incarnationId: 'inc_orphan',
        pin: {
          agentId: descriptor.agent.id,
          agentVersion: descriptor.agent.version,
          definitionDigest: descriptor.definitionDigest,
        },
        process: {
          fingerprint: `sha256:${'0'.repeat(64)}`,
          pid: 2_147_483_647,
          processGroupId: 2_147_483_647,
          startedAt: '2026-09-05T00:00:01.000Z',
        },
        sessionId: 'dlg_orphan',
        state: 'running',
      },
    ],
  });

  expect(removed).toEqual([{ incarnationId: 'inc_orphan', sessionId: 'dlg_orphan' }]);
  expect(manager.sessions.get('dlg_orphan')).toBeUndefined();
  await manager.shutdown();
});

test('the session facet remains discoverable but fails closed without session storage', async () => {
  const manager = createAgentManager({
    activeStateSink: noOpActiveStateSink,
    definitions: [fakeAcpDefinition({ mode: 'session' })],
  });
  await manager.initialize({ invocations: [] });
  const descriptor = manager.sessions.listAgents()[0];
  if (descriptor === undefined) throw new Error('Expected a session-capable fake agent.');

  expect(manager.sessions.inspect('dlg_missing')).toBeUndefined();
  expect(manager.sessions.list()).toEqual([]);
  expect(manager.sessions.getTerminal('dlg_missing')).toBeUndefined();
  expect(manager.sessions.listTerminal()).toEqual([]);
  await expect(manager.sessions.cancel('dlg_missing')).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_state_unavailable' },
  });
  await expect(
    manager.sessions.respond('dlg_missing', {
      requestId: 'req_missing',
      response: { kind: 'permission', outcome: 'denied' },
    }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.session_state_unavailable' } });
  await expect(
    manager.sessions.resume({
      output: { directory: '/unused' },
      parameters: {},
      permissions: {},
      token: {
        cursor: { eventId: 'evt_missing', sequence: 1, streamId: 'stream_missing' },
        eligibility: 'hibernated',
        payload: 'unused',
        pin: {
          agentId: descriptor.agent.id,
          agentVersion: descriptor.agent.version,
          definitionDigest: descriptor.definitionDigest,
        },
        resumeTokenId: 'tok_missing',
        schemaVersion: 'agent-session-resume-token/v1',
        sessionId: 'dlg_missing',
        sha256: 'unused',
      },
      workspace: { directory: '/unused' },
    }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.session_state_unavailable' } });
  await manager.shutdown();
});

test('rejects session recovery rows when session storage is not configured', async () => {
  const manager = createAgentManager({
    activeStateSink: noOpActiveStateSink,
    definitions: [fakeAcpDefinition({ mode: 'session' })],
  });
  const descriptor = manager.sessions.listAgents()[0];
  if (descriptor === undefined) throw new Error('Expected a session-capable fake agent.');

  await expect(
    manager.initialize({
      invocations: [],
      sessions: [
        {
          acceptedAt: '2026-09-05T00:00:00.000Z',
          incarnationId: 'inc_unconfigured',
          pin: {
            agentId: descriptor.agent.id,
            agentVersion: descriptor.agent.version,
            definitionDigest: descriptor.definitionDigest,
          },
          process: {
            fingerprint: `sha256:${'0'.repeat(64)}`,
            pid: 1,
            processGroupId: 1,
            startedAt: '2026-09-05T00:00:01.000Z',
          },
          sessionId: 'dlg_unconfigured',
          state: 'running',
        },
      ],
    }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.session_state_unavailable' } });
  await manager.initialize([]);
  await manager.shutdown();
});
