import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('cancels a running turn through lookup without cancelling its later replacement', async () => {
  const story = createAgentSessionStory({
    cancellations: [{ status: 'requested' }],
    turns: [
      { steps: [{ type: 'wait', barrier: 'first' }], outcome: { status: 'cancelled' } },
      {
        steps: [
          { type: 'wait', barrier: 'second' },
          { type: 'reply', content: 'Still running.' },
        ],
      },
    ],
  });
  const session = await story.open('dlg_cancel');
  const first = await session.send({ prompt: 'Wait.', turnId: 'trn_first' });
  await story.waitForAgent('first');
  const runningSnapshot = story.sessions.inspectTurn(session.sessionId, first.turnId);
  const recovered = story.sessions.getTurn(session.sessionId, first.turnId)!;

  await expect(recovered.cancel()).resolves.toEqual({ state: 'requested' });
  story.releaseAgent('first');
  await expect(recovered.result()).resolves.toEqual({ status: 'cancelled' });
  expect(story.sessions.inspectTurn(session.sessionId, first.turnId)).toMatchObject({
    state: 'completed',
    result: { status: 'cancelled' },
  });
  expect(runningSnapshot?.state).toBe('running');

  const second = await session.send({ prompt: 'Continue.', turnId: 'trn_second' });
  await story.waitForAgent('second');
  await expect(recovered.cancel()).resolves.toEqual({
    state: 'already_completed',
    result: { status: 'cancelled' },
  });
  expect(story.sessions.inspectTurn(session.sessionId, second.turnId)?.state).toBe('running');
  expect(story.providerCallTypes().filter((type) => type === 'prompt.cancel')).toHaveLength(1);
  story.releaseAgent('second');
  await expect(second.result()).resolves.toMatchObject({ status: 'completed' });
  await story.close(session);
});

test('failed turn remains inspectable after closing its session', async () => {
  const story = createAgentSessionStory({
    turns: [
      {
        steps: [],
        outcome: {
          status: 'failed',
          failure: { code: 'transport_failed', message: 'Transport failed.', retryable: false },
        },
      },
    ],
  });
  const session = await story.open('dlg_failed');
  const turn = await session.send({ prompt: 'Work.', turnId: 'trn_failed' });
  await expect(turn.result()).resolves.toMatchObject({ status: 'failed' });
  await story.settle();
  expect(story.sessions.get(session.sessionId)).toBeDefined();
  await story.close(session);

  expect(story.sessions.inspectTurn(session.sessionId, turn.turnId)).toMatchObject({
    state: 'completed',
    result: { status: 'failed', error: { code: 'revo.agent.protocol_failed' } },
  });
  expect(story.activeProcesses()).toBe(0);
});
