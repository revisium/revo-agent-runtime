import { createHash } from 'node:crypto';

import { expect, test } from 'vitest';

import { encodeContinuationPayload } from '../../../../../src/application/session/boundary/checkpoint/decode.js';
import { continuationDigest } from '../../../../../src/application/session/boundary/checkpoint/digest.js';
import {
  createManagedAgentSessionController,
  createManagedAgentSessions,
} from '../../../../../src/application/session/management/managed-sessions.js';
import type {
  AgentSessionAgentDescriptor,
  AgentSessionTerminalRecord,
} from '../../../../../src/contracts/session.js';
import type { PublicSessionCommand } from '../../../../../src/execution/session/kernel/command/public.js';
import type {
  PublicCallResolution,
  PublicCallSettlement,
  SessionCommandRuntime,
  SessionOpeningCommand,
  SessionRuntimeFactory,
} from '../../../../../src/execution/session/runtime/actor/port.js';

const sessionCapabilities = {
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;
const descriptor: AgentSessionAgentDescriptor = {
  agent: { id: 'fake', version: '1' },
  capabilities: {
    cancellation: true,
    session: sessionCapabilities,
    structuredResult: true,
    usage: true,
  },
  definitionDigest: 'definition-digest',
  displayName: 'Fake agent',
};

class ReadyRuntime implements SessionCommandRuntime {
  readonly #calls = new Map<string, (settlement: PublicCallSettlement) => void>();
  readonly commands: PublicSessionCommand[] = [];
  terminalRecord: AgentSessionTerminalRecord | undefined;

  constructor(
    readonly opening: SessionOpeningCommand,
    private readonly terminalOnCancel: boolean = true,
  ) {}

  dispatch(command: PublicSessionCommand) {
    this.commands.push(command);
    if (command.type === 'session.open' || command.type === 'session.resume')
      this.#resolve(command.call.callId, { kind: 'session_ready' });
    if (command.type === 'session.cancel' && this.terminalOnCancel)
      this.terminalRecord = {
        acceptedAt: this.opening.opening.acceptedAt,
        cleanup: 'confirmed',
        finishedAt: this.opening.opening.acceptedAt,
        pin: this.opening.opening.pin,
        sessionId: this.opening.call.sessionId,
        status: 'cancelled',
      };
    if (command.type === 'session.cancel')
      this.#resolve(command.call.callId, {
        kind: 'cancel_session',
        result: { state: 'requested' },
      });
    if (command.type === 'interaction.respond')
      this.#resolve(command.call.callId, {
        kind: 'interaction',
        result: { state: 'accepted' },
      });
    return { state: 'accepted' as const };
  }

  inspect() {
    return {
      acceptedAt: this.opening.opening.acceptedAt,
      capabilities: sessionCapabilities,
      openedAt: this.opening.opening.acceptedAt,
      outputDirectory: this.opening.opening.request.request.output.directory,
      pendingInteractions: [],
      pin: this.opening.opening.pin,
      sessionId: this.opening.call.sessionId,
      status: 'idle' as const,
    };
  }

  registerCall(callId: string): Promise<PublicCallSettlement> {
    return new Promise((resolve) => this.#calls.set(callId, resolve));
  }

  terminal() {
    return this.terminalRecord;
  }

  whenQuiescent(): Promise<void> {
    return Promise.resolve();
  }

  #resolve(callId: string, resolution: PublicCallResolution): void {
    this.#calls.get(callId)?.({ resolution, state: 'resolved' });
  }
}

const digest = {
  digest: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
};

const openInput = (sessionId: string = 'dlg_01') => ({
  agent: descriptor.agent,
  output: { directory: `/output/${sessionId}` },
  parameters: {},
  permissions: {},
  sessionId,
  workspace: { directory: '/workspace' },
});

const controllerSetup = (runtimeFactory?: SessionRuntimeFactory) => {
  let identity = 0;
  const runtimes: ReadyRuntime[] = [];
  const factory =
    runtimeFactory ??
    ({
      createOpening: (opening) => {
        const runtime = new ReadyRuntime(opening);
        runtimes.push(runtime);
        return runtime;
      },
    } satisfies SessionRuntimeFactory);
  const options = {
    agents: [descriptor],
    clock: { now: () => ({ iso: '2026-09-05T00:00:00.000Z', milliseconds: 1_000 }) },
    digest,
    nextIdentity: (kind: 'call' | 'checkpoint' | 'resume_token' | 'incarnation' | 'stream') =>
      `${kind}-${++identity}`,
    runtimeFactory: factory,
  };
  return { controller: createManagedAgentSessionController(options), options, runtimes };
};

const setup = () => {
  const runtimes: ReadyRuntime[] = [];
  const runtimeFactory: SessionRuntimeFactory = {
    createOpening: (opening) => {
      const runtime = new ReadyRuntime(opening);
      runtimes.push(runtime);
      return runtime;
    },
  };
  let identity = 0;
  const sessions = createManagedAgentSessions({
    agents: [descriptor],
    clock: { now: () => ({ iso: '2026-09-05T00:00:00.000Z', milliseconds: 1_000 }) },
    digest,
    nextIdentity: (kind) => `${kind}-${++identity}`,
    runtimeFactory,
  });
  return { runtimes, sessions };
};

test('managed sessions expose a small consumer facade over one isolated runtime', async () => {
  const { runtimes, sessions } = setup();

  const session = await sessions.open({
    agent: descriptor.agent,
    metadata: { source: 'test' },
    output: { directory: '/output' },
    parameters: {},
    permissions: {},
    sessionId: 'dlg_01',
    workspace: { directory: '/workspace' },
  });

  expect(session.sessionId).toBe('dlg_01');
  expect(sessions.listAgents()).toEqual([descriptor]);
  expect(sessions.get('dlg_01')).toBe(session);
  expect(sessions.inspect('dlg_01')).toMatchObject({ status: 'idle' });
  await expect(
    sessions.respond('dlg_01', {
      requestId: 'req_01',
      response: { kind: 'permission', outcome: 'denied' },
    }),
  ).resolves.toEqual({ state: 'accepted' });
  await expect(sessions.cancel('dlg_01')).resolves.toEqual({ state: 'requested' });
  expect(runtimes[0]?.commands.map(({ type }) => type)).toEqual([
    'session.open',
    'interaction.respond',
    'session.cancel',
  ]);
});

test('resume validates a token before passing its native continuation to the runtime', async () => {
  const { runtimes, sessions } = setup();
  const pin = {
    agentId: descriptor.agent.id,
    agentVersion: descriptor.agent.version,
    definitionDigest: descriptor.definitionDigest,
  };
  const payload = encodeContinuationPayload({
    provider: { data: { providerSessionId: 'native-1' }, format: 'fake/v1' },
    schemaVersion: 'agent-session-continuation-envelope/v1',
    usageBaseline: { scope: 'session_cumulative' },
  });
  const tokenWithoutDigest = {
    cursor: { eventId: 'dlg_01:1:event:4', sequence: 4, streamId: 'stream-1' },
    eligibility: 'hibernated' as const,
    payload,
    pin,
    resumeTokenId: 'resume-1',
    schemaVersion: 'agent-session-resume-token/v1' as const,
    sessionId: 'dlg_01',
  };
  const token = { ...tokenWithoutDigest, sha256: continuationDigest(tokenWithoutDigest, digest) };

  const session = await sessions.resume({
    metadata: { source: 'resume-test' },
    output: { directory: '/output/resumed' },
    parameters: {},
    permissions: {},
    token,
    workspace: { directory: '/workspace' },
  });

  expect(session.sessionId).toBe('dlg_01');
  expect(runtimes[0]?.opening).toMatchObject({
    call: { epoch: 1, sessionId: 'dlg_01' },
    opening: {
      request: {
        continuation: { data: { providerSessionId: 'native-1' }, format: 'fake/v1' },
        kind: 'resume',
      },
    },
    type: 'session.resume',
  });
});

test('facade distinguishes active, terminal, and unknown sessions', async () => {
  const { controller } = controllerSetup();
  const session = await controller.sessions.open(openInput());

  expect(controller.sessions.list()).toHaveLength(1);
  expect(controller.sessions.listTerminal()).toEqual([]);
  await expect(controller.sessions.cancel(session.sessionId, 'done')).resolves.toEqual({
    state: 'requested',
  });
  expect(controller.sessions.get(session.sessionId)).toBeUndefined();
  expect(controller.sessions.getTerminal(session.sessionId)).toMatchObject({ status: 'cancelled' });
  expect(controller.sessions.listTerminal({ statuses: ['cancelled'] })).toHaveLength(1);
  await expect(controller.sessions.cancel(session.sessionId)).resolves.toEqual({
    state: 'already_terminal',
  });
  await expect(controller.sessions.cancel('unknown')).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_unknown' },
  });
  await expect(
    controller.sessions.respond('unknown', {
      requestId: 'req',
      response: { kind: 'permission', outcome: 'denied' },
    }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.session_unknown' } });
});

test.each([
  {
    label: 'rejected opening call',
    settlement: {
      fault: {
        code: 'revo.agent.protocol_failed',
        message: 'failed',
        phase: 'session_opening',
        retryable: false,
      },
      state: 'rejected',
    } satisfies PublicCallSettlement,
    code: 'revo.agent.protocol_failed',
  },
  {
    label: 'unexpected opening resolution',
    settlement: {
      resolution: { kind: 'cancel_session', result: { state: 'requested' } },
      state: 'resolved',
    } satisfies PublicCallSettlement,
    code: 'revo.agent.internal',
  },
] as const)('contains $label', async ({ settlement, code }) => {
  const runtimeFactory: SessionRuntimeFactory = {
    createOpening: (opening) => ({
      dispatch: () => ({ state: 'accepted' }),
      inspect: () => ({
        acceptedAt: opening.opening.acceptedAt,
        capabilities: sessionCapabilities,
        outputDirectory: opening.opening.request.request.output.directory,
        pendingInteractions: [],
        pin: opening.opening.pin,
        sessionId: opening.call.sessionId,
        status: 'opening',
      }),
      registerCall: async () => settlement,
      terminal: () => undefined,
      whenQuiescent: async () => undefined,
    }),
  };
  const { controller } = controllerSetup(runtimeFactory);
  await expect(controller.sessions.open(openInput())).rejects.toMatchObject({
    fault: { code },
  });
});

test('fails closed when a ready runtime omits negotiated session capabilities', async () => {
  const runtimeFactory: SessionRuntimeFactory = {
    createOpening: (opening) => ({
      dispatch: () => ({ state: 'accepted' }),
      inspect: () => ({
        acceptedAt: opening.opening.acceptedAt,
        outputDirectory: opening.opening.request.request.output.directory,
        pendingInteractions: [],
        pin: opening.opening.pin,
        sessionId: opening.call.sessionId,
        status: 'idle',
      }),
      registerCall: async () => ({ resolution: { kind: 'session_ready' }, state: 'resolved' }),
      terminal: () => undefined,
      whenQuiescent: async () => undefined,
    }),
  };
  const { controller } = controllerSetup(runtimeFactory);
  await expect(controller.sessions.open(openInput())).rejects.toMatchObject({
    fault: { code: 'revo.agent.internal' },
  });
});

test('aborting a pending opening dispatches cancellation before detaching the signal', async () => {
  const openingCall = Promise.withResolvers<PublicCallSettlement>();
  const commands: PublicSessionCommand[] = [];
  const runtimeFactory: SessionRuntimeFactory = {
    createOpening: (opening) => ({
      dispatch: (command) => {
        commands.push(command);
        if (command.type === 'session.cancel')
          queueMicrotask(() =>
            settlements.get(command.call.callId)?.({
              resolution: { kind: 'cancel_session', result: { state: 'requested' } },
              state: 'resolved',
            }),
          );
        return { state: 'accepted' };
      },
      inspect: () => ({
        acceptedAt: opening.opening.acceptedAt,
        capabilities: sessionCapabilities,
        outputDirectory: opening.opening.request.request.output.directory,
        pendingInteractions: [],
        pin: opening.opening.pin,
        sessionId: opening.call.sessionId,
        status: 'opening',
      }),
      registerCall: (callId) => {
        if (callId === opening.call.callId) return openingCall.promise;
        return new Promise((resolve) => settlements.set(callId, resolve));
      },
      terminal: () => undefined,
      whenQuiescent: async () => undefined,
    }),
  };
  const settlements = new Map<string, (value: PublicCallSettlement) => void>();
  const { controller } = controllerSetup(runtimeFactory);
  const abort = new AbortController();
  const pending = controller.sessions.open(openInput(), { signal: abort.signal });
  abort.abort();
  await expect.poll(() => commands.map(({ type }) => type)).toContain('session.cancel');
  openingCall.resolve({ resolution: { kind: 'session_ready' }, state: 'resolved' });
  await expect(pending).resolves.toMatchObject({ sessionId: 'dlg_01' });
});

test('aborting ignores an opening already reconciled as terminal', async () => {
  const openingCall = Promise.withResolvers<PublicCallSettlement>();
  const commands: PublicSessionCommand[] = [];
  const runtimeFactory: SessionRuntimeFactory = {
    createOpening: (opening) => ({
      dispatch: (command) => {
        commands.push(command);
        return { state: 'accepted' };
      },
      inspect: () => ({
        acceptedAt: opening.opening.acceptedAt,
        capabilities: sessionCapabilities,
        outputDirectory: opening.opening.request.request.output.directory,
        pendingInteractions: [],
        pin: opening.opening.pin,
        sessionId: opening.call.sessionId,
        status: 'opening',
      }),
      registerCall: () => openingCall.promise,
      terminal: () => ({
        acceptedAt: opening.opening.acceptedAt,
        cleanup: 'confirmed',
        finishedAt: opening.opening.acceptedAt,
        pin: opening.opening.pin,
        sessionId: opening.call.sessionId,
        status: 'cancelled',
      }),
      whenQuiescent: async () => undefined,
    }),
  };
  const { controller } = controllerSetup(runtimeFactory);
  const abort = new AbortController();
  const pending = controller.sessions.open(openInput(), { signal: abort.signal });

  abort.abort();
  openingCall.resolve({ resolution: { kind: 'session_ready' }, state: 'resolved' });
  await expect(pending).resolves.toMatchObject({ sessionId: 'dlg_01' });
  expect(commands.map(({ type }) => type)).toEqual(['session.open']);
});

test('shutdown cancels a pending opening without inventing an absent reason', async () => {
  const openingCall = Promise.withResolvers<PublicCallSettlement>();
  const settlements = new Map<string, (value: PublicCallSettlement) => void>();
  const commands: PublicSessionCommand[] = [];
  let terminal: AgentSessionTerminalRecord | undefined;
  const runtimeFactory: SessionRuntimeFactory = {
    createOpening: (opening) => ({
      dispatch: (command) => {
        commands.push(command);
        if (command.type === 'session.cancel') {
          terminal = {
            acceptedAt: opening.opening.acceptedAt,
            cleanup: 'confirmed',
            finishedAt: opening.opening.acceptedAt,
            pin: opening.opening.pin,
            sessionId: opening.call.sessionId,
            status: 'cancelled',
          };
          queueMicrotask(() =>
            settlements.get(command.call.callId)?.({
              resolution: { kind: 'cancel_session', result: { state: 'requested' } },
              state: 'resolved',
            }),
          );
        }
        return { state: 'accepted' };
      },
      inspect: () => ({
        acceptedAt: opening.opening.acceptedAt,
        capabilities: sessionCapabilities,
        outputDirectory: opening.opening.request.request.output.directory,
        pendingInteractions: [],
        pin: opening.opening.pin,
        sessionId: opening.call.sessionId,
        status: 'opening',
      }),
      registerCall: (callId) => {
        if (callId === opening.call.callId) return openingCall.promise;
        return new Promise((resolve) => settlements.set(callId, resolve));
      },
      terminal: () => terminal,
      whenQuiescent: async () => undefined,
    }),
  };
  const { controller } = controllerSetup(runtimeFactory);
  const pending = controller.sessions.open(openInput());

  await expect(controller.shutdown()).resolves.toBeUndefined();
  expect(commands.at(-1)).toMatchObject({ type: 'session.cancel' });
  expect(commands.at(-1)).not.toHaveProperty('reason');
  openingCall.resolve({ resolution: { kind: 'session_ready' }, state: 'resolved' });
  await expect(pending).resolves.toMatchObject({ sessionId: 'dlg_01' });
});

test('shutdown is idempotent, cancels active handles, and closes admission', async () => {
  const { controller, runtimes } = controllerSetup();
  await controller.sessions.open(openInput());

  const first = controller.shutdown('manager shutdown');
  const second = controller.shutdown('ignored');
  expect(second).toBe(first);
  await expect(first).resolves.toBeUndefined();
  expect(runtimes[0]?.commands.at(-1)).toMatchObject({
    reason: 'manager shutdown',
    type: 'session.cancel',
  });
  await expect(controller.sessions.open(openInput('dlg_after'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.manager_closed' },
  });
});

test('shutdown fails closed when runtime quiescence has no terminal cleanup proof', async () => {
  const runtimes: ReadyRuntime[] = [];
  const story = controllerSetup({
    createOpening: (opening) => {
      const runtime = new ReadyRuntime(opening, false);
      runtimes.push(runtime);
      return runtime;
    },
  });
  await story.controller.sessions.open(openInput());

  await expect(story.controller.shutdown()).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed' },
  });
  expect(runtimes[0]?.commands.at(-1)?.type).toBe('session.cancel');
});

test('initialization exposes recovery availability and its quiescence boundary', async () => {
  const unavailable = controllerSetup().controller;
  await expect(unavailable.initialize([])).resolves.toBeUndefined();
  await expect(unavailable.whenInitializationQuiescent()).resolves.toBeUndefined();
  await expect(unavailable.initialize({})).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_state_unavailable' },
  });

  const base = controllerSetup();
  const recovered = createManagedAgentSessionController({
    ...base.options,
    activeStateSink: {
      remove: async () => ({ state: 'applied' }),
      save: async () => ({ state: 'applied' }),
    },
    recoveryInspector: {
      inspectAndReconcileRecoveredProcess: async () => ({ status: 'absent' }),
    },
  });
  await expect(recovered.initialize([])).resolves.toBeUndefined();
  await expect(recovered.whenInitializationQuiescent()).resolves.toBeUndefined();
});
