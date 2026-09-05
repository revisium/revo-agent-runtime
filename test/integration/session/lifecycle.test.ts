import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('consumer cancels one turn and reuses the same session', async () => {
  const story = createAgentSessionStory({
    cancellations: [{ status: 'requested' }],
    turns: [
      {
        outcome: { status: 'cancelled' },
        steps: [{ barrier: 'cancelled-turn', type: 'wait' }],
      },
      { steps: [{ content: 'The session is still usable.', type: 'reply' }] },
    ],
  });
  const session = await story.open('dlg_cancel_turn');
  const cancelledTurn = await session.send({ prompt: 'Wait.', turnId: 'trn_cancel' });

  await story.waitForAgent('cancelled-turn');
  await expect(cancelledTurn.cancel('No longer needed.')).resolves.toEqual({ state: 'requested' });
  story.releaseAgent('cancelled-turn');
  await expect(cancelledTurn.result()).resolves.toEqual({ status: 'cancelled' });

  const nextTurn = await session.send({ prompt: 'Continue.', turnId: 'trn_after_cancel' });
  await expect(nextTurn.result()).resolves.toMatchObject({
    message: { content: 'The session is still usable.' },
    status: 'completed',
  });
  expect(story.providerCallTypes()).toEqual(['open.fresh', 'prompt', 'prompt.cancel', 'prompt']);
});

test('consumer hibernates and resumes without overlapping physical processes', async () => {
  const story = createAgentSessionStory({
    checkpoints: [{ providerSessionId: 'native-session-1' }],
    openings: ['fresh', 'resume'],
    turns: [
      { steps: [{ content: 'Before hibernation.', type: 'reply' }] },
      { steps: [{ content: 'After resume.', type: 'reply' }] },
    ],
  });
  const first = await story.open('dlg_resume');
  const before = await first.send({ prompt: 'Start.', turnId: 'trn_before' });
  await expect(before.result()).resolves.toMatchObject({ status: 'completed' });

  const hibernation = await first.hibernate('Release the worker.');
  expect(hibernation).toMatchObject({ state: 'hibernated' });
  if (hibernation.state !== 'hibernated') throw new Error('Expected fresh hibernation.');
  expect(story.activeProcesses()).toBe(0);
  expect(story.sessions.get('dlg_resume')).toBeUndefined();
  expect(story.sessions.getTerminal('dlg_resume')).toMatchObject({ status: 'hibernated' });

  const resumed = await story.resume(hibernation.resumeToken);
  expect(story.activeProcesses()).toBe(1);
  const after = await resumed.send({ prompt: 'Continue.', turnId: 'trn_after' });
  await expect(after.result()).resolves.toMatchObject({
    message: { content: 'After resume.' },
    status: 'completed',
  });
  await expect(resumed.close()).resolves.toEqual({ state: 'closed' });

  expect(story.activeProcesses()).toBe(0);
  expect(story.maximumActiveProcesses()).toBe(1);
  expect(story.providerCallTypes()).toEqual([
    'open.fresh',
    'prompt',
    'checkpoint',
    'session.close',
    'open.resume',
    'prompt',
    'session.close',
  ]);
});

test('consumer cannot start concurrent turns or use a terminal handle', async () => {
  const story = createAgentSessionStory({
    turns: [{ steps: [{ barrier: 'busy-turn', type: 'wait' }] }],
  });
  const session = await story.open('dlg_guards');
  const turn = await session.send({ prompt: 'Wait.', turnId: 'trn_busy' });
  await story.waitForAgent('busy-turn');

  await expect(session.send({ prompt: 'Overlap.', turnId: 'trn_overlap' })).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_busy' },
  });
  story.releaseAgent('busy-turn');
  await expect(turn.result()).resolves.toMatchObject({ status: 'completed' });
  await session.close();
  await expect(session.send({ prompt: 'Too late.', turnId: 'trn_late' })).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_closed' },
  });
});
