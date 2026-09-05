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

  constructor(private readonly status: 'idle' | 'running' = 'idle') {}

  dispatch(command: PublicSessionCommand) {
    this.commands.push(command);
    if (command.type === 'turn.send') {
      this.#resolve(command.call.callId, { kind: 'turn_ready', turnId: command.input.turnId });
      this.#resolve(command.resultCallId, {
        kind: 'turn_result',
        result: {
          message: { content: 'Done', role: 'assistant' },
          status: 'completed',
        },
      });
    }
    if (command.type === 'turn.cancel')
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
    return { state: 'accepted' as const };
  }

  inspect() {
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

const handleFor = (runtime: ImmediateRuntime) => {
  let identity = 0;
  return createAgentSessionHandle({
    capabilities,
    clock: { now: () => ({ iso: '2026-09-05T00:00:00.000Z', milliseconds: 1_000 }) },
    decodeResponse: () => ({
      requestId: 'req_01',
      response: { kind: 'permission', outcome: 'denied' },
    }),
    decodeSend: () => ({ prompt: 'Do the work', turnId: 'trn_01' }),
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
