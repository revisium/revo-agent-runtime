import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('evicts old completed lookups without invalidating handles or forgetting duplicate IDs', async () => {
  const story = createAgentSessionStory({
    managerLimits: { maxCompletedTurns: 1 },
    replies: ['First.', 'Second.'],
  });
  const session = await story.open('dlg_retention');
  const first = await session.send({ prompt: 'First.', turnId: 'trn_first' });
  const firstResult = await first.result();
  const second = await session.send({ prompt: 'Second.', turnId: 'trn_second' });
  await second.result();

  expect(story.sessions.getTurn(session.sessionId, first.turnId)).toBeUndefined();
  expect(story.sessions.inspectTurn(session.sessionId, first.turnId)).toBeUndefined();
  expect(story.sessions.getTurn(session.sessionId, second.turnId)).toBe(second);
  await expect(first.result()).resolves.toEqual(firstResult);
  await expect(first.cancel()).resolves.toEqual({
    state: 'already_completed',
    result: firstResult,
  });
  await expect(session.send({ prompt: 'Duplicate.', turnId: first.turnId })).rejects.toMatchObject({
    fault: { code: 'revo.agent.turn_duplicate' },
  });
  await story.close(session);
});

test('bounds completed lookups across sessions without evicting an active turn', async () => {
  const story = createAgentSessionStory({
    managerLimits: { maxCompletedTurns: 1 },
    openings: ['fresh', 'fresh'],
    turns: [
      {
        steps: [
          { type: 'wait', barrier: 'active' },
          { type: 'reply', content: 'Active done.' },
        ],
      },
      { steps: [{ type: 'reply', content: 'First.' }] },
      { steps: [{ type: 'reply', content: 'Second.' }] },
    ],
  });
  const activeSession = await story.open('dlg_active');
  const active = await activeSession.send({ prompt: 'Wait.', turnId: 'trn_shared' });
  await story.waitForAgent('active');
  const otherSession = await story.open('dlg_other');
  const first = await otherSession.send({ prompt: 'First.', turnId: 'trn_shared' });
  await first.result();
  const second = await otherSession.send({ prompt: 'Second.', turnId: 'trn_second' });
  await second.result();

  expect(story.sessions.getTurn(otherSession.sessionId, first.turnId)).toBeUndefined();
  expect(story.sessions.getTurn(activeSession.sessionId, active.turnId)).toBe(active);
  expect(story.sessions.inspectTurn(activeSession.sessionId, active.turnId)).toMatchObject({
    state: 'running',
  });

  story.releaseAgent('active');
  await active.result();
  expect(story.sessions.getTurn(otherSession.sessionId, second.turnId)).toBeUndefined();
  await story.close(activeSession);
  await story.close(otherSession);
});

test('does not retain an oversized result but keeps the caller handle usable', async () => {
  const content = 'Ж'.repeat(600);
  const story = createAgentSessionStory({
    managerLimits: { maxCompletedTurnBytes: 1_024 },
    replies: [content],
  });
  const session = await story.open('dlg_bytes');
  const turn = await session.send({ prompt: 'Reply.', turnId: 'trn_large' });

  await expect(turn.result()).resolves.toMatchObject({ message: { content }, status: 'completed' });
  expect(story.sessions.getTurn(session.sessionId, turn.turnId)).toBeUndefined();
  await expect(turn.cancel()).resolves.toMatchObject({ state: 'already_completed' });
  await story.close(session);
});

test('evicts by total serialized bytes even below the completed count limit', async () => {
  const story = createAgentSessionStory({
    managerLimits: { maxCompletedTurnBytes: 1_024, maxCompletedTurns: 10 },
    replies: ['a'.repeat(500), 'b'.repeat(500)],
  });
  const session = await story.open('dlg_bytes');
  const first = await session.send({ prompt: 'First.', turnId: 'trn_first' });
  await first.result();
  expect(story.sessions.getTurn(session.sessionId, first.turnId)).toBe(first);
  const second = await session.send({ prompt: 'Second.', turnId: 'trn_second' });
  await second.result();

  expect(story.sessions.getTurn(session.sessionId, first.turnId)).toBeUndefined();
  expect(story.sessions.getTurn(session.sessionId, second.turnId)).toBe(second);
  await story.close(session);
});
