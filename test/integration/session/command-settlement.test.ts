import { setTimeout as delay } from 'node:timers/promises';

import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('native continuation preserves accepted turn identities', async () => {
  const story = createAgentSessionStory({
    openings: ['fresh', 'resume'],
    replies: ['Before.', 'Must not run.'],
    checkpoint: { providerSessionId: 'native' },
  });
  const first = await story.open('dlg_turn_resume');
  await (await first.send({ prompt: 'Work.', turnId: 'trn_before' })).result();
  const hibernated = await first.hibernate();
  const resumed = await story.resume(hibernated.resumeToken);
  await expect(resumed.send({ prompt: 'Retry.', turnId: 'trn_before' })).rejects.toMatchObject({
    fault: { code: 'revo.agent.turn_duplicate' },
  });
  await story.close(resumed);
});

test('a completed turn can be cancelled again without leaving a pending command', async () => {
  const story = createAgentSessionStory({ replies: ['Done.', 'Next.'] });
  const session = await story.open('dlg_completed_turn');
  const first = await session.send({ prompt: 'Start.', turnId: 'trn_first' });
  const result = await first.result();
  await expect(first.cancel()).resolves.toEqual({ result, state: 'already_completed' });
  await (await session.send({ prompt: 'Next.', turnId: 'trn_next' })).result();
  await expect(first.cancel()).resolves.toEqual({ result, state: 'already_completed' });
  await story.close(session);
}, 1_000);

test('terminal handles settle repeated lifecycle and interaction commands', async () => {
  const story = createAgentSessionStory({ replies: [] });
  const session = await story.open('dlg_terminal_commands');
  await session.close();
  await expect(session.close()).resolves.toEqual({ state: 'already_terminal' });
  await expect(session.cancel()).resolves.toEqual({ state: 'already_terminal' });
  await expect(session.checkpoint()).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_closed' },
  });
  await expect(session.hibernate()).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_closed' },
  });
  await expect(
    session.respond({
      requestId: 'req_missing',
      response: { kind: 'permission', outcome: 'denied' },
    }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.session_closed' } });
  await story.settle();
}, 1_000);

test('a duplicate turn identity is rejected before another provider prompt', async () => {
  const story = createAgentSessionStory({ replies: ['First.', 'Must not run.'] });
  const session = await story.open('dlg_duplicate_turn');
  await (await session.send({ prompt: 'Work.', turnId: 'trn_same' })).result();
  await expect(session.send({ prompt: 'Retry.', turnId: 'trn_same' })).rejects.toMatchObject({
    fault: { code: 'revo.agent.turn_duplicate' },
  });
  expect(story.providerCallTypes().filter((type) => type === 'prompt')).toHaveLength(1);
  await story.close(session);
});

test('cancel acknowledgement cannot admit a new turn before provider completion', async () => {
  const story = createAgentSessionStory({
    cancellations: [{ status: 'requested' }],
    turns: [
      {
        steps: [{ type: 'wait', barrier: 'provider-still-running' }],
        outcome: { status: 'cancelled' },
      },
      { steps: [{ type: 'reply', content: 'Next.' }] },
    ],
  });
  const session = await story.open('dlg_cancel_fence');
  const first = await session.send({ prompt: 'Wait.', turnId: 'trn_first' });
  await story.waitForAgent('provider-still-running');
  try {
    await first.cancel();
    await expect.poll(() => story.providerCallTypes()).toContain('prompt.cancel');
    await expect(
      session.send({ prompt: 'Too early.', turnId: 'trn_overlap' }),
    ).rejects.toMatchObject({
      fault: { code: 'revo.agent.session_busy' },
    });
    expect(story.providerCallTypes().filter((type) => type === 'prompt')).toHaveLength(1);
  } finally {
    story.releaseAgent('provider-still-running');
    await first.result();
    await story.close(session);
  }
});

test('a human may answer after the ordinary operation deadline', async () => {
  const story = createAgentSessionStory({
    cancellations: [{ status: 'requested' }],
    interactions: [{ status: 'accepted' }],
    turns: [
      {
        steps: [
          {
            type: 'interaction',
            request: {
              kind: 'permission',
              requestId: 'req_human',
              action: { kind: 'read' },
              options: [{ kind: 'allow_once', optionId: 'allow', label: 'Allow' }],
            },
          },
          { type: 'wait', barrier: 'human-answer' },
          { type: 'reply', content: 'Answered.' },
        ],
      },
    ],
  });
  const session = await story.open('dlg_human_wait', {
    limits: { operationTimeoutMs: 100, eventSinkTimeoutMs: 100 },
  });
  const turn = await session.send({ prompt: 'Ask me.', turnId: 'trn_human' });
  await story.waitForAgent('human-answer');
  try {
    await delay(250);
    expect(story.sessions.inspect(session.sessionId)?.status).toBe('running');
    expect(story.providerCallTypes()).not.toContain('prompt.cancel');
    await session.respond({
      requestId: 'req_human',
      response: {
        kind: 'permission',
        outcome: 'selected',
        optionId: 'allow',
      },
    });
  } finally {
    story.releaseAgent('human-answer');
    await turn.result();
    await story.close(session);
  }
});
