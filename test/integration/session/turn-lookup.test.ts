import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('a fast completion is visible to every waiter as an immutable redacted result', async () => {
  const secret = 'synthetic-turn-secret';
  const story = createAgentSessionStory({ replies: [`Reply ${secret}.`] });
  const session = await story.open('dlg_fast', {
    context: { environment: { inherit: [], variables: {}, secrets: { TOKEN: secret } } },
  });
  const turn = await session.send({ prompt: 'Reply.', turnId: 'trn_fast' });
  const recovered = story.sessions.getTurn(session.sessionId, turn.turnId);
  expect(recovered).toBeDefined();

  const [first, second] = await Promise.all([turn.result(), recovered!.result()]);
  expect(second).toBe(first);
  const snapshot = story.sessions.inspectTurn(session.sessionId, turn.turnId)!;
  expect(snapshot).toEqual({
    sessionId: session.sessionId,
    turnId: turn.turnId,
    state: 'completed',
    result: first,
  });
  expect(JSON.stringify(snapshot)).not.toContain(secret);
  expect(Reflect.set(snapshot, 'state', 'running')).toBe(false);
  expect(Reflect.set(first, 'status', 'cancelled')).toBe(false);
  if (first.status !== 'completed') throw new Error('Expected completed reply.');
  expect(Reflect.set(first.message, 'content', 'Changed.')).toBe(false);
  await story.close(session);
});

test('looks up an accepted running turn within its session', async () => {
  const story = createAgentSessionStory({
    turns: [
      {
        steps: [
          { type: 'wait', barrier: 'reply' },
          { type: 'reply', content: 'Done.' },
        ],
      },
    ],
  });
  const session = await story.open('dlg_lookup');
  const turn = await session.send({ prompt: 'Work.', turnId: 'trn_work' });
  await story.waitForAgent('reply');

  expect(story.sessions.getTurn(session.sessionId, turn.turnId)).toBe(turn);
  expect(story.sessions.inspectTurn(session.sessionId, turn.turnId)).toEqual({
    sessionId: session.sessionId,
    turnId: turn.turnId,
    state: 'running',
  });
  expect(story.sessions.getTurn('dlg_unknown', turn.turnId)).toBeUndefined();
  expect(story.sessions.inspectTurn(session.sessionId, 'trn_unknown')).toBeUndefined();

  story.releaseAgent('reply');
  await turn.result();
  await story.close(session);
});

test('retains the completed result after closing the session without retaining provider resources', async () => {
  const story = createAgentSessionStory({ replies: ['Remembered.'] });
  const session = await story.open('dlg_completed');
  const turn = await session.send({ prompt: 'Remember this.', turnId: 'trn_first' });
  const result = await turn.result();
  await story.close(session);

  const recovered = story.sessions.getTurn(session.sessionId, turn.turnId);
  expect(recovered).toBeDefined();
  await expect(recovered?.result()).resolves.toEqual(result);
  expect(story.sessions.inspectTurn(session.sessionId, turn.turnId)).toEqual({
    sessionId: session.sessionId,
    turnId: turn.turnId,
    state: 'completed',
    result,
  });
  expect(story.retainedPreparations()).toBe(0);
  expect(story.retainedProviders()).toBe(0);
  expect(story.activeProcesses()).toBe(0);
});
