import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('a retained turn cannot cancel a new turn in a resumed incarnation', async () => {
  const story = createAgentSessionStory({
    checkpoint: { providerSessionId: 'native-session' },
    openings: ['fresh', 'resume'],
    turns: [
      { steps: [{ type: 'reply', content: 'Before.' }] },
      {
        steps: [
          { type: 'wait', barrier: 'resumed' },
          { type: 'reply', content: 'After.' },
        ],
      },
    ],
  });
  const session = await story.open('dlg_resume');
  const before = await session.send({ prompt: 'Start.', turnId: 'trn_before' });
  const beforeResult = await before.result();
  const hibernation = await session.hibernate();
  if (hibernation.state !== 'hibernated') throw new Error('Expected fresh hibernation.');
  expect(story.sessions.getTurn(session.sessionId, before.turnId)).toBe(before);

  const resumed = await story.resume(hibernation.resumeToken);
  const after = await resumed.send({ prompt: 'Continue.', turnId: 'trn_after' });
  await story.waitForAgent('resumed');

  const retained = story.sessions.getTurn(resumed.sessionId, before.turnId);
  await expect(retained?.cancel('Cancel the old turn.')).resolves.toEqual({
    state: 'already_completed',
    result: beforeResult,
  });
  expect(story.sessions.inspectTurn(resumed.sessionId, after.turnId)).toMatchObject({
    state: 'running',
  });
  expect(story.providerCallTypes()).not.toContain('prompt.cancel');

  story.releaseAgent('resumed');
  await expect(after.result()).resolves.toMatchObject({ message: { content: 'After.' } });
  await story.close(resumed);
});

test('a new manager resumes the conversation without recovering old turn results', async () => {
  const original = createAgentSessionStory({
    checkpoint: { providerSessionId: 'native-session' },
    replies: ['Remembered.'],
  });
  const session = await original.open('dlg_transfer');
  const first = await session.send({ prompt: 'Remember.', turnId: 'trn_original' });
  await first.result();
  const hibernation = await session.hibernate();
  if (hibernation.state !== 'hibernated') throw new Error('Expected fresh hibernation.');

  const replacement = createAgentSessionStory({ openings: ['resume'], replies: ['Continued.'] });
  const resumed = await replacement.resume(hibernation.resumeToken);

  expect(replacement.sessions.getTurn(resumed.sessionId, first.turnId)).toBeUndefined();
  expect(replacement.sessions.inspectTurn(resumed.sessionId, first.turnId)).toBeUndefined();
  await expect(resumed.send({ prompt: 'Duplicate.', turnId: first.turnId })).rejects.toMatchObject({
    fault: { code: 'revo.agent.turn_duplicate' },
  });
  const next = await resumed.send({ prompt: 'Continue.', turnId: 'trn_new' });
  await next.result();
  expect(replacement.sessions.getTurn(resumed.sessionId, next.turnId)).toBe(next);
  await replacement.close(resumed);
});
