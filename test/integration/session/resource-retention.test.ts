import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('closed sessions release preparations independently of terminal record retention', async () => {
  const story = createAgentSessionStory({ replies: [], openings: ['fresh', 'fresh'] });
  await story.completeEmptySessions(['dlg_first', 'dlg_second']);

  expect(story.retainedPreparations()).toBe(0);
  expect(story.sessions.listTerminal()).toHaveLength(2);
});
