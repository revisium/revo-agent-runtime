import { expect, test } from 'vitest';

import type { SessionState } from '../../../../../../src/execution/session/kernel/model/session-state.js';
import { projectSessionSnapshot } from '../../../../../../src/execution/session/kernel/projection/snapshot.js';
import { projectTerminalRecord } from '../../../../../../src/execution/session/kernel/projection/terminal-record.js';
import { createOpeningSessionState } from '../../../../../../src/execution/session/kernel/reducer/opening/state.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

test('projects an active session without exposing kernel internals', () => {
  const state = idleSessionState();
  expect(projectSessionSnapshot(state)).toEqual({
    acceptedAt: state.acceptedAt,
    capabilities: state.capabilities,
    cursor: state.events.cursor,
    openedAt: state.openedAt,
    outputDirectory: state.outputDirectory,
    pendingInteractions: [],
    pin: state.pin,
    sessionId: state.sessionId,
    status: 'idle',
  });
  expect(projectTerminalRecord(state)).toBeUndefined();
});

test('projects every active phase and pending interaction state', () => {
  const idle = idleSessionState();
  const turn = {
    handleCallId: 'send_01',
    prompt: 'Continue',
    resultCallId: 'result_01',
    status: 'starting',
    turnId: 'turn_01',
  } as const;
  const interaction = {
    request: { kind: 'input', message: 'Choose', questions: [], requestId: 'request_01' },
    scope: { kind: 'turn', turnId: 'turn_01' },
  } as const;
  const correlation = { effectId: 'effect_01', epoch: 1, sessionId: idle.sessionId } as const;
  const states = [
    { ...idle, interactions: [{ ...interaction, stage: 'publishing' }], status: 'idle' },
    { ...idle, interactions: [{ ...interaction, stage: 'ready' }], status: 'idle' },
    {
      ...idle,
      interactions: [
        {
          ...interaction,
          delivery: { stage: 'publishing' },
          response: { kind: 'input', outcome: 'declined' },
          stage: 'responding',
        },
      ],
      status: 'idle',
    },
    { ...idle, status: 'running', turn },
    {
      ...idle,
      callId: 'checkpoint_01',
      checkpointId: 'checkpoint_01',
      progress: { correlation, stage: 'capturing' },
      status: 'checkpointing',
    },
    {
      ...idle,
      callId: 'hibernate_01',
      progress: { correlation, stage: 'capturing' },
      resumeTokenId: 'token_01',
      status: 'hibernating',
    },
    {
      ...idle,
      callIds: [],
      intent: { outcome: 'closed' },
      progress: { correlation, stage: 'cleaning_process' },
      status: 'closing',
    },
    {
      ...idle,
      callIds: [],
      intent: { outcome: 'cancelled' },
      progress: { stage: 'settling_turn', turn },
      status: 'cancelling',
    },
  ] satisfies readonly SessionState[];
  const snapshots = states.map(projectSessionSnapshot);
  expect(snapshots.map((snapshot) => snapshot?.status)).toEqual([
    'idle',
    'idle',
    'idle',
    'running',
    'checkpointing',
    'hibernating',
    'closing',
    'cancelling',
  ]);
  expect(snapshots.slice(0, 3).map((snapshot) => snapshot?.pendingInteractions[0]?.state)).toEqual([
    'publishing',
    'ready',
    'responding',
  ]);
  expect(snapshots[3]?.activeTurnId).toBe('turn_01');
  expect(snapshots[7]?.activeTurnId).toBe('turn_01');

  const opening = createOpeningSessionState(sessionOpeningCommand());
  expect(projectSessionSnapshot(opening)).toMatchObject({ status: 'opening' });
  const uncertain = {
    ...opening,
    error: {
      code: 'revo.agent.process_cleanup_failed',
      message: 'uncertain',
      phase: 'session_terminal',
      retryable: true,
    },
    status: 'cleanup_uncertain',
  } satisfies Extract<SessionState, { readonly status: 'cleanup_uncertain' }>;
  expect(projectSessionSnapshot(uncertain)).toMatchObject({ status: 'cleanup_uncertain' });
  expect(projectSessionSnapshot({ ...idle, metadata: { tenant: 'one' } })).toMatchObject({
    metadata: { tenant: 'one' },
  });
});
