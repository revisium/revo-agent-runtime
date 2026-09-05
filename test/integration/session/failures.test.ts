import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('event sink failure cannot produce a false successful turn', async () => {
  const story = createAgentSessionStory({
    rejectEvent: 'assistant.message.delta',
    replies: ['This message must not be reported as completed.'],
  });
  const session = await story.open('dlg_sink_failure');
  const turn = await session.send({ prompt: 'Reply.', turnId: 'trn_sink_failure' });

  await expect(turn.result()).resolves.toMatchObject({
    error: { code: 'revo.agent.event_sink_failed', phase: 'session_delivery' },
    status: 'failed',
  });
  await story.settle();
  expect(story.sessions.get('dlg_sink_failure')).toBeUndefined();
  expect(story.sessions.getTerminal('dlg_sink_failure')).toMatchObject({
    error: { code: 'revo.agent.event_sink_failed' },
    status: 'failed',
  });
  expect(story.eventTypes()).not.toContain('turn.completed');
});

test('event sink timeout cannot produce a false successful turn', async () => {
  const story = createAgentSessionStory({
    eventSinkTimeoutMs: 100,
    replies: ['This late event cannot complete the turn.'],
    stallEvent: 'assistant.message.delta',
  });
  const session = await story.open('dlg_sink_timeout');
  const turn = await session.send({ prompt: 'Reply.', turnId: 'trn_sink_timeout' });

  await expect(turn.result()).resolves.toMatchObject({
    error: { code: 'revo.agent.event_sink_failed', phase: 'session_delivery' },
    status: 'failed',
  });
  await story.settle();
  expect(story.sessions.getTerminal('dlg_sink_timeout')).toMatchObject({ status: 'failed' });
  expect(story.eventTypes()).not.toContain('turn.completed');
});
