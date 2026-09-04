import { expect, test } from 'vitest';

import type { SessionState } from '../../../../../../src/execution/session/kernel/model/session-state.js';
import { projectSessionSnapshot } from '../../../../../../src/execution/session/kernel/projection/snapshot.js';
import { projectTerminalRecord } from '../../../../../../src/execution/session/kernel/projection/terminal-record.js';
import { createOpeningSessionState } from '../../../../../../src/execution/session/kernel/reducer/opening/state.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

test('projects every confirmed terminal record variant', () => {
  const active = idleSessionState();
  const {
    capabilities: _capabilities,
    lastTurn: _lastTurn,
    process: _process,
    processResourceId: _processResourceId,
    providerResourceId: _providerResourceId,
    status: _status,
    ...base
  } = active;
  const terminal = {
    ...base,
    finishedAt: '2026-03-21T00:01:00.000Z',
    status: 'closed',
    timers: [],
  } satisfies Extract<SessionState, { readonly status: 'closed' }>;
  expect(projectSessionSnapshot(terminal)).toBeUndefined();
  expect(projectTerminalRecord(terminal)).toMatchObject({
    cleanup: 'confirmed',
    openedAt: active.openedAt,
    status: 'closed',
  });

  const fault = {
    code: 'revo.agent.internal',
    message: 'failed',
    phase: 'session_terminal',
    retryable: false,
  } as const;
  const common = { ...terminal, status: undefined };
  const records: readonly SessionState[] = [
    { ...common, status: 'cancelled' },
    { ...common, error: fault, status: 'failed' },
    { ...common, error: fault, status: 'timed_out' },
    {
      ...common,
      resumeToken: {
        cursor: terminal.events.cursor!,
        eligibility: 'hibernated',
        payload: 'payload',
        pin: terminal.pin,
        resumeTokenId: 'token_01',
        schemaVersion: 'agent-session-resume-token/v1',
        sessionId: terminal.sessionId,
        sha256: 'sha',
      },
      status: 'hibernated',
    },
  ];
  expect(records.map(projectTerminalRecord).map((record) => record?.status)).toEqual([
    'cancelled',
    'failed',
    'timed_out',
    'hibernated',
  ]);

  const opening = createOpeningSessionState(sessionOpeningCommand());
  const failedBeforeOpen = {
    ...opening,
    error: fault,
    finishedAt: terminal.finishedAt,
    status: 'failed',
  } satisfies Extract<SessionState, { readonly status: 'failed' }>;
  expect(projectTerminalRecord(failedBeforeOpen)).toEqual({
    acceptedAt: opening.acceptedAt,
    cleanup: 'confirmed',
    error: fault,
    finishedAt: terminal.finishedAt,
    pin: opening.pin,
    sessionId: opening.sessionId,
    status: 'failed',
  });
});
