import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('inspection cannot change the actor journal cursor or retained terminal record', async () => {
  const story = createAgentSessionStory({ replies: ['Done.'] });
  const session = await story.open('dlg_owned_reads');
  const snapshot = story.sessions.inspect(session.sessionId)!;
  const cursor = structuredClone(snapshot.cursor);
  expect(Reflect.set(snapshot.cursor!, 'sequence', 999)).toBe(false);
  expect(story.sessions.inspect(session.sessionId)?.cursor).toEqual(cursor);
  const result = await (await session.send({ prompt: 'Work.', turnId: 'trn_owned' })).result();
  expect(Object.isFrozen(result)).toBe(true);
  await session.close();
  const terminal = story.sessions.getTerminal(session.sessionId)!;
  expect(Reflect.set(terminal, 'status', 'cancelled')).toBe(false);
  expect(story.sessions.getTerminal(session.sessionId)?.status).toBe('closed');
});
