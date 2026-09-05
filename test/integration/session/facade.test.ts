import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('consumer facade runs a complete session without exposing engine mechanics', async () => {
  const story = createAgentSessionStory({
    checkpoint: { providerSessionId: 'native-session-1' },
    replies: ['Remembered.', 'The nonce is 7KQ.'],
  });
  const session = await story.open('dlg_01');

  const first = await session.send({ prompt: 'Remember nonce 7KQ.', turnId: 'trn_01' });
  await expect(first.result()).resolves.toMatchObject({
    message: { content: 'Remembered.' },
    status: 'completed',
  });

  const second = await session.send({ prompt: 'What was the nonce?', turnId: 'trn_02' });
  await expect(second.result()).resolves.toMatchObject({
    message: { content: 'The nonce is 7KQ.' },
    status: 'completed',
  });

  await expect(session.checkpoint()).resolves.toMatchObject({
    eligibility: 'observation_only',
    sessionId: 'dlg_01',
  });
  await expect(session.close()).resolves.toEqual({ state: 'closed' });

  expect(story.sessions.get('dlg_01')).toBeUndefined();
  expect(story.sessions.getTerminal('dlg_01')).toMatchObject({ status: 'closed' });
  expect(story.eventTypes()).toEqual([
    'session.accepted',
    'session.opened',
    'turn.started',
    'assistant.message.delta',
    'assistant.message.completed',
    'turn.completed',
    'turn.started',
    'assistant.message.delta',
    'assistant.message.completed',
    'turn.completed',
    'session.checkpointed',
    'session.closed',
  ]);
  expect(story.providerCallTypes()).toEqual([
    'open.fresh',
    'prompt',
    'prompt',
    'checkpoint',
    'session.close',
  ]);
});
