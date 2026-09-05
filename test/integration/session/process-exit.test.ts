import { expect, test } from 'vitest';

import { createAgentSessionStory } from '../../support/session/story/session-story.js';

test('provider exit while idle fails and releases the session without a consumer command', async () => {
  const story = createAgentSessionStory({ replies: [] });
  const session = await story.open('dlg_exit_idle');
  story.exitAgent();
  await expect
    .poll(() => story.sessions.getTerminal(session.sessionId)?.status, { timeout: 500 })
    .toBe('failed');
  await story.settle();
  expect(story.activeProcesses()).toBe(0);
  expect(story.retainedPreparations()).toBe(0);
});

const turnModes = [
  { mode: 'streaming', steps: [] },
  {
    mode: 'awaiting permission',
    steps: [
      {
        type: 'interaction',
        request: {
          kind: 'permission',
          requestId: 'req_wait',
          action: { kind: 'read' },
          options: [{ kind: 'allow_once', optionId: 'allow', label: 'Allow' }],
        },
      },
    ],
  },
] as const;

test.each(turnModes)(
  'provider exit during $mode settles the turn and ignores late completion',
  async ({ steps }) => {
    const story = createAgentSessionStory({
      turns: [
        {
          steps: [...steps, { type: 'wait', barrier: 'before-exit' }],
        },
      ],
    });
    const session = await story.open('dlg_exit_running');
    const turn = await session.send({ prompt: 'Work.', turnId: 'trn_exit' });
    await story.waitForAgent('before-exit');
    try {
      story.exitAgent();
      await expect(turn.result()).resolves.toMatchObject({
        status: 'failed',
        error: { code: 'revo.agent.protocol_failed' },
      });
      await story.settle();
      expect(story.sessions.getTerminal(session.sessionId)?.status).toBe('failed');
    } finally {
      story.releaseAgent('before-exit');
    }
  },
  1_000,
);
