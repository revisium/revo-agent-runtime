import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('an uncooperative prompt fails the turn and session, publishes completion, and is reaped', async () => {
  const story = createAgentSessionStory({
    cancellations: [{ status: 'requested' }],
    turns: [{ steps: [{ type: 'wait', barrier: 'uncooperative' }] }],
  });
  const session = await story.open('dlg_uncooperative', {
    limits: { operationTimeoutMs: 100, eventSinkTimeoutMs: 100 },
  });
  const turn = await session.send({ prompt: 'Wait.', turnId: 'trn_uncooperative' });
  await story.waitForAgent('uncooperative');
  await turn.cancel();
  await expect(turn.result()).resolves.toMatchObject({
    status: 'failed',
    error: { code: 'revo.agent.timeout' },
  });
  await story.settle();
  expect(story.sessions.getTerminal(session.sessionId)).toMatchObject({ status: 'failed' });
  expect(story.events()).toContainEqual(
    expect.objectContaining({
      type: 'turn.completed',
      turnId: turn.turnId,
      outcome: expect.objectContaining({ status: 'failed' }),
    }),
  );
  expect(story.activeProcesses()).toBe(0);
  await expect(
    session.send({ prompt: 'Cannot overlap.', turnId: 'trn_next' }),
  ).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_closed' },
  });
  story.releaseAgent('uncooperative');
  await story.settle();
  expect(story.events().filter(({ type }) => type === 'turn.completed')).toHaveLength(1);
});
