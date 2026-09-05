import { expect, test, vi } from 'vitest';

import { dispatchCall, resolutionOf } from '../../../../../src/application/session/handles/call.js';
import type { PublicSessionCommand } from '../../../../../src/execution/session/kernel/command/public.js';
import type { SessionCommandRuntime } from '../../../../../src/execution/session/runtime/actor/port.js';

const fault = {
  code: 'revo.agent.session_closed' as const,
  message: 'closed',
  phase: 'session_running' as const,
  retryable: false,
};

test('extracts the expected resolution and rejects faults or mismatched kinds', () => {
  expect(
    resolutionOf(
      { resolution: { kind: 'close', result: { state: 'closed' } }, state: 'resolved' },
      'close',
    ),
  ).toEqual({ kind: 'close', result: { state: 'closed' } });
  expect(() => resolutionOf({ fault, state: 'rejected' }, 'close')).toThrowError(
    expect.objectContaining({ fault }),
  );
  expect(() =>
    resolutionOf(
      { resolution: { kind: 'cancel_session', result: { state: 'requested' } }, state: 'resolved' },
      'close',
    ),
  ).toThrowError(
    expect.objectContaining({ fault: expect.objectContaining({ code: 'revo.agent.internal' }) }),
  );
});

test('registers a call before dispatch and returns its typed settlement', async () => {
  const order: string[] = [];
  const command = {
    call: { callId: 'call', epoch: 1, sessionId: 'dlg' },
    observedAt: '2026-09-05T00:00:00.000Z',
    observedAtMs: 1,
    type: 'session.close',
  } satisfies PublicSessionCommand;
  const runtime: SessionCommandRuntime = {
    dispatch: () => {
      order.push('dispatch');
      return { state: 'accepted' };
    },
    inspect: () => undefined,
    registerCall: vi.fn<SessionCommandRuntime['registerCall']>(async () => {
      order.push('register');
      return { resolution: { kind: 'close', result: { state: 'closed' } }, state: 'resolved' };
    }),
    terminal: () => undefined,
    whenQuiescent: async () => undefined,
  };

  await expect(dispatchCall(runtime, command, 'close')).resolves.toMatchObject({ kind: 'close' });
  expect(order).toEqual(['register', 'dispatch']);
});
