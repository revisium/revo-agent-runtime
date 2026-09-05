import { createHash } from 'node:crypto';

import { expect, test } from 'vitest';

import { encodeContinuationPayload } from '../../../../../src/application/session/boundary/checkpoint/decode.js';
import { continuationDigest } from '../../../../../src/application/session/boundary/checkpoint/digest.js';
import { createManagedAgentSessions } from '../../../../../src/application/session/management/managed-sessions.js';
import type { AgentSessionAgentDescriptor } from '../../../../../src/contracts/session.js';
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

  constructor(readonly opening: SessionOpeningCommand) {}

  dispatch(command: PublicSessionCommand) {
    this.commands.push(command);
    if (command.type === 'session.open' || command.type === 'session.resume')
      this.#resolve(command.call.callId, { kind: 'session_ready' });
    if (command.type === 'session.cancel')
      this.#resolve(command.call.callId, {
        kind: 'cancel_session',
        result: { state: 'requested' },
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
    return undefined;
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
  await expect(sessions.cancel('dlg_01')).resolves.toEqual({ state: 'requested' });
  expect(runtimes[0]?.commands.map(({ type }) => type)).toEqual(['session.open', 'session.cancel']);
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
