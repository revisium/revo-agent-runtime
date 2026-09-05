import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('a process returning after opening cancellation is reaped', async () => {
  const story = createAgentSessionStory({ processStartBarrier: 'process-start' });
  const opening = story.open('dlg_late_process').catch((error: unknown) => error);
  await story.waitForAgent('process-start');
  await story.sessions.cancel('dlg_late_process');
  await expect(opening).resolves.toMatchObject({ fault: { code: 'revo.agent.cancelled' } });
  story.releaseAgent('process-start');
  await story.settle();
  expect(story.activeProcesses()).toBe(0);
  expect(story.retainedPreparations()).toBe(0);
});

test('consumer answers an opening interaction before receiving a session handle', async () => {
  const story = createAgentSessionStory({
    interactions: [{ status: 'accepted' }],
    openingSteps: [
      {
        type: 'interaction',
        request: {
          kind: 'permission',
          requestId: 'req_open',
          action: { kind: 'read' },
          options: [{ kind: 'allow_once', optionId: 'allow', label: 'Allow' }],
        },
      },
      { type: 'wait', barrier: 'opening-answer' },
    ],
  });
  const opening = story.open('dlg_opening_answer');
  await story.waitForAgent('opening-answer');
  try {
    expect(story.sessions.inspect('dlg_opening_answer')?.status).toBe('opening');
    await expect(
      story.sessions.respond('dlg_opening_answer', {
        requestId: 'req_open',
        response: { kind: 'permission', outcome: 'selected', optionId: 'allow' },
      }),
    ).resolves.toEqual({ state: 'accepted' });
  } finally {
    story.releaseAgent('opening-answer');
    await story.close(await opening);
  }
});

test('consumer cancels an opening session by identity and cleans up a late provider', async () => {
  const story = createAgentSessionStory({
    openingSteps: [{ type: 'wait', barrier: 'provider-opening' }],
  });
  const opening = story.open('dlg_opening_cancel');
  const outcome = opening.then(
    () => 'opened',
    (error: unknown) => error,
  );
  await story.waitForAgent('provider-opening');
  try {
    await expect(story.sessions.cancel('dlg_opening_cancel')).resolves.toEqual({
      state: 'requested',
    });
    await expect(outcome).resolves.toMatchObject({ fault: { code: 'revo.agent.cancelled' } });
  } finally {
    story.releaseAgent('provider-opening');
    const result = await outcome;
    if (result === 'opened') await (await opening).close();
    await story.settle();
  }
  expect(story.activeProcesses()).toBe(0);
  expect(story.retainedPreparations()).toBe(0);
});

test('repeated opening cancellation releases the provider while the opened event is pending', async () => {
  const story = createAgentSessionStory({
    eventSinkTimeoutMs: 100,
    stallEvent: 'session.opened',
  });
  const opening = story.open('dlg_pending_event').catch((error: unknown) => error);
  await expect.poll(() => story.retainedProviders()).toBe(1);

  await Promise.all([
    story.sessions.cancel('dlg_pending_event'),
    story.sessions.cancel('dlg_pending_event'),
  ]);
  await expect(opening).resolves.toMatchObject({ fault: { code: 'revo.agent.cancelled' } });
  await story.settle();

  expect(story.retainedProviders()).toBe(0);
  expect(story.retainedPreparations()).toBe(0);
  expect(story.activeProcesses()).toBe(0);
});
