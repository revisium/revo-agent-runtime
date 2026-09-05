import { expect, test } from 'vitest';

import { createAgentSessionHandle } from '../../../../../src/application/session/handles/session.js';
import type { PublicSessionCommand } from '../../../../../src/execution/session/kernel/command/public.js';
import type { PublicCallResolution } from '../../../../../src/execution/session/kernel/effect/public-call.js';
import type {
  PublicCallSettlement,
  SessionCommandRuntime,
} from '../../../../../src/execution/session/runtime/actor/port.js';

const capabilities = {
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;
const pin = { agentId: 'fake', agentVersion: '1', definitionDigest: 'digest' };

class ImmediateRuntime implements SessionCommandRuntime {
  readonly commands: PublicSessionCommand[] = [];
  readonly #calls = new Map<string, (settlement: PublicCallSettlement) => void>();

  constructor(
    private readonly status: 'idle' | 'running' | 'terminal' = 'idle',
    private readonly onTurnSend?: () => void,
    private readonly rejectTurnCancellation: boolean = false,
  ) {}

  dispatch(command: PublicSessionCommand) {
    this.commands.push(command);
    if (command.type === 'turn.send') {
      this.#resolve(command.call.callId, { kind: 'turn_ready', turnId: command.input.turnId });
      this.onTurnSend?.();
      this.#resolve(command.resultCallId, {
        kind: 'turn_result',
        result: {
          message: { content: 'Done', role: 'assistant' },
          status: 'completed',
        },
      });
    }
    if (command.type === 'turn.cancel') {
      if (this.rejectTurnCancellation)
        this.#calls.get(command.call.callId)?.({
          fault: {
            code: 'revo.agent.cancelled',
            message: 'Cancellation failed.',
            phase: 'session_running',
            retryable: false,
          },
          state: 'rejected',
        });
      else
        this.#resolve(command.call.callId, {
          kind: 'cancel_turn',
          result: {
            result: {
              message: { content: 'Done', role: 'assistant' },
              status: 'completed',
            },
            state: 'already_completed',
          },
        });
    }
    if (command.type === 'session.cancel')
      this.#resolve(command.call.callId, {
        kind: 'cancel_session',
        result: { state: 'requested' },
      });
    if (command.type === 'session.close')
      this.#resolve(command.call.callId, { kind: 'close', result: { state: 'closed' } });
    if (command.type === 'interaction.respond')
      this.#resolve(command.call.callId, { kind: 'interaction', result: { state: 'accepted' } });
    if (command.type === 'session.checkpoint')
      this.#resolve(command.call.callId, {
        checkpoint: {
          checkpointId: command.checkpointId,
          cursor: { eventId: 'event', sequence: 1, streamId: 'stream' },
          eligibility: 'observation_only',
          payload: 'payload',
          pin,
          schemaVersion: 'agent-session-checkpoint/v1',
          sessionId: 'dlg_01',
          sha256: 'digest',
        },
        kind: 'checkpoint',
      });
    if (command.type === 'session.hibernate')
      this.#resolve(command.call.callId, {
        kind: 'hibernate',
        result: {
          resumeToken: {
            cursor: { eventId: 'event', sequence: 1, streamId: 'stream' },
            eligibility: 'hibernated',
            payload: 'payload',
            pin,
            resumeTokenId: command.resumeTokenId,
            schemaVersion: 'agent-session-resume-token/v1',
            sessionId: 'dlg_01',
            sha256: 'digest',
          },
          state: 'hibernated',
        },
      });
    return { state: 'accepted' as const };
  }

  inspect() {
    if (this.status === 'terminal') return undefined;
    return {
      acceptedAt: '2026-09-05T00:00:00.000Z',
      capabilities,
      openedAt: '2026-09-05T00:00:00.000Z',
      outputDirectory: '/output',
      pendingInteractions: [],
      pin,
      sessionId: 'dlg_01',
      status: this.status,
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

const handleFor = (runtime: ImmediateRuntime, withMetadata: boolean = false) => {
  let identity = 0;
  return createAgentSessionHandle({
    capabilities,
    clock: { now: () => ({ iso: '2026-09-05T00:00:00.000Z', milliseconds: 1_000 }) },
    decodeResponse: () => ({
      requestId: 'req_01',
      response: { kind: 'permission', outcome: 'denied' },
    }),
    decodeSend: () => ({
      ...(withMetadata ? { metadata: { source: 'test' } } : {}),
      prompt: 'Do the work',
      turnId: 'trn_01',
    }),
    epoch: 1,
    nextIdentity: (kind) => `${kind}-${++identity}`,
    onSettled: () => undefined,
    pin,
    runtime,
    sessionId: 'dlg_01',
  });
};

test('session and turn handles hide command correlation from the consumer', async () => {
  const runtime = new ImmediateRuntime();
  const session = handleFor(runtime);

  const turn = await session.send({ prompt: 'Do the work', turnId: 'trn_01' });

  await expect(turn.result()).resolves.toEqual({
    message: { content: 'Done', role: 'assistant' },
    status: 'completed',
  });
  await expect(turn.cancel()).resolves.toMatchObject({ state: 'already_completed' });
  expect(runtime.commands.map(({ type }) => type)).toEqual(['turn.send', 'turn.cancel']);
  expect(runtime.commands[0]).toMatchObject({
    call: { epoch: 1, sessionId: 'dlg_01', turnId: 'trn_01' },
    input: { prompt: 'Do the work', turnId: 'trn_01' },
  });
});

test('rejects a second turn before allocating its result call', async () => {
  const runtime = new ImmediateRuntime('running');
  const session = handleFor(runtime);

  await expect(session.send({ prompt: 'Overlap', turnId: 'trn_02' })).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_busy' },
  });
  expect(runtime.commands).toEqual([]);
});

test('rejects a turn after the runtime becomes terminal', async () => {
  const runtime = new ImmediateRuntime('terminal');
  await expect(
    handleFor(runtime).send({ prompt: 'Late', turnId: 'trn_late' }),
  ).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_closed' },
  });
});

test('dispatches every session lifecycle command through the same correlation boundary', async () => {
  const runtime = new ImmediateRuntime();
  const session = handleFor(runtime);

  await expect(
    session.respond({
      requestId: 'ignored-by-decoder',
      response: { kind: 'permission', outcome: 'denied' },
    }),
  ).resolves.toEqual({ state: 'accepted' });
  await expect(session.checkpoint()).resolves.toMatchObject({ eligibility: 'observation_only' });
  await expect(session.hibernate()).resolves.toMatchObject({ state: 'hibernated' });
  await expect(session.hibernate('hibernate')).resolves.toMatchObject({ state: 'hibernated' });
  await expect(session.close('close')).resolves.toEqual({ state: 'closed' });
  await expect(session.cancel('cancel')).resolves.toEqual({ state: 'requested' });
  expect(runtime.commands.map(({ type }) => type)).toEqual([
    'interaction.respond',
    'session.checkpoint',
    'session.hibernate',
    'session.hibernate',
    'session.close',
    'session.cancel',
  ]);
  expect(runtime.commands).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: 'hibernate', type: 'session.hibernate' }),
      expect.objectContaining({ reason: 'close', type: 'session.close' }),
      expect.objectContaining({ reason: 'cancel', type: 'session.cancel' }),
    ]),
  );
});

test('rejects an already-aborted turn before allocating runtime calls', async () => {
  const runtime = new ImmediateRuntime();
  const controller = new AbortController();
  controller.abort();

  await expect(
    handleFor(runtime).send(
      { prompt: 'Cancelled', turnId: 'trn_cancelled' },
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.cancelled' } });
  expect(runtime.commands).toEqual([]);
});

test('cancels when the signal aborts while turn admission is settling', async () => {
  const controller = new AbortController();
  const runtime = new ImmediateRuntime('idle', () => controller.abort());

  const turn = await handleFor(runtime, true).send(
    { metadata: { source: 'test' }, prompt: 'Work', turnId: 'trn_abort_race' },
    { signal: controller.signal },
  );
  await turn.result();
  await Promise.resolve();
  expect(runtime.commands.map(({ type }) => type)).toContain('turn.cancel');
});

test('contains a rejected signal-driven turn cancellation', async () => {
  const controller = new AbortController();
  const runtime = new ImmediateRuntime('idle', () => controller.abort(), true);
  const turn = await handleFor(runtime).send(
    { prompt: 'Work', turnId: 'trn_abort_rejected' },
    { signal: controller.signal },
  );
  await turn.result();
  await Promise.resolve();
  expect(runtime.commands.map(({ type }) => type)).toContain('turn.cancel');
});
