import { expect, test } from 'vitest';

import { executionEvidenceStory } from '../../../support/builders/execution-evidence.js';

test('launches the freshly resolved executable and retains delayed authentic exit evidence', async () => {
  const story = executionEvidenceStory();
  const admission = await story.execution.admission;
  expect(admission).toMatchObject({
    launch: { executable: '/resolved/agent', reportedVersion: '1.2.3' },
    status: 'accepted',
  });
  expect(story.launch()?.command).toBe('/resolved/agent');

  story.execution.activate();
  await story.cleanup();
  expect(story.execution.evidence()).toBeUndefined();
  story.resolveProcessExit({ exitCode: 7, signal: null });

  await expect(story.execution.completion).resolves.toEqual({
    status: 'succeeded',
    value: { answer: 'accepted' },
  });
  expect(story.execution.evidence()).toEqual({
    launch: { executable: '/resolved/agent', reportedVersion: '1.2.3' },
    processExit: { exitCode: 7, signal: null },
  });
  await expect(story.execution.drainage).resolves.toMatchObject({
    evidence: {
      launch: { executable: '/resolved/agent', reportedVersion: '1.2.3' },
      processExit: { exitCode: 7, signal: null },
    },
    status: 'terminal',
  });
});
