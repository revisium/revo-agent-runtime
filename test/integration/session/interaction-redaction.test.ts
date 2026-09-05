import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('secret-bearing identities never reach the first durable event', async () => {
  const story = createAgentSessionStory({ replies: [] });
  const opening = story.open('dlg_sensitive_marker', {
    context: {
      environment: { inherit: [], variables: {}, secrets: { TOKEN: 'sensitive_marker' } },
    },
  });
  const outcome = await opening.then(
    (session) => ({ session }),
    (error: unknown) => ({ error }),
  );
  if ('session' in outcome) await story.close(outcome.session);

  expect(outcome).toMatchObject({ error: { fault: { code: 'revo.agent.event_sink_failed' } } });
  expect(story.events()).toEqual([]);
});

test('interaction display text is redacted before reaching events and inspection', async () => {
  const marker = 'synthetic-interaction-secret';
  const story = createAgentSessionStory({
    interactions: [{ status: 'accepted' }],
    turns: [
      {
        steps: [
          {
            type: 'interaction',
            request: {
              kind: 'permission',
              requestId: 'req_safe',
              action: { kind: 'read', title: marker },
              options: [{ kind: 'allow_once', optionId: 'allow', label: marker }],
            },
          },
          { type: 'wait', barrier: 'answer' },
        ],
      },
    ],
  });
  const session = await story.open('dlg_redacted_interaction', {
    context: { environment: { inherit: [], variables: {}, secrets: { TOKEN: marker } } },
  });
  const turn = await session.send({ prompt: 'Ask.', turnId: 'trn_ask' });
  await story.waitForAgent('answer');
  try {
    expect(JSON.stringify(story.events())).not.toContain(marker);
    expect(JSON.stringify(story.sessions.inspect(session.sessionId))).not.toContain(marker);
    await expect(
      session.respond({
        requestId: 'req_safe',
        response: {
          kind: 'permission',
          outcome: 'selected',
          optionId: 'allow',
        },
      }),
    ).resolves.toEqual({ state: 'accepted' });
  } finally {
    story.releaseAgent('answer');
    await turn.result();
    await story.close(session);
  }
});
