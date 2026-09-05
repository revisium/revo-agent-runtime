import { expect, test } from 'vitest';

import type { AgentSessionInteractiveRequest } from '../../../src/contracts/session.js';
import { createAgentSessionStory } from '../../support/session/story/session-story.js';

const permission: AgentSessionInteractiveRequest = {
  action: { kind: 'edit', title: 'Update generated files' },
  kind: 'permission',
  options: [
    { kind: 'allow_once', label: 'Allow once', optionId: 'allow' },
    { kind: 'reject_once', label: 'Reject', optionId: 'reject' },
  ],
  requestId: 'req_permission',
};

const input: AgentSessionInteractiveRequest = {
  kind: 'input',
  message: 'Choose the deliverables and retry count.',
  questions: [
    {
      allowOther: false,
      input: 'select',
      options: [
        { label: 'Tests', optionId: 'tests' },
        { label: 'Docs', optionId: 'docs' },
      ],
      questionId: 'targets',
      required: true,
      selection: 'multiple',
      title: 'Deliverables',
    },
    {
      input: 'number',
      integer: true,
      maximum: 3,
      minimum: 1,
      questionId: 'retries',
      required: true,
      title: 'Retries',
    },
  ],
  requestId: 'req_input',
};

test('consumer answers sequential permission and multi-select input requests', async () => {
  const story = createAgentSessionStory({
    interactions: [
      { outcome: { status: 'accepted' }, wait: 'permission-delivery' },
      { outcome: { status: 'accepted' }, wait: 'input-delivery' },
    ],
    turns: [
      {
        steps: [
          { request: permission, type: 'interaction' },
          { barrier: 'permission-turn', type: 'wait' },
          { request: input, type: 'interaction' },
          { barrier: 'input-turn', type: 'wait' },
          { content: 'All choices received.', type: 'reply' },
        ],
      },
    ],
  });
  const session = await story.open('dlg_interactions');
  const turn = await session.send({ prompt: 'Prepare the release.', turnId: 'trn_interactions' });

  await story.waitForAgent('permission-turn');
  const permissionResponse = {
    requestId: 'req_permission',
    response: { kind: 'permission' as const, optionId: 'allow', outcome: 'selected' as const },
  };
  const accepted = session.respond(permissionResponse);
  await story.waitForAgent('permission-delivery');
  await expect(session.respond(permissionResponse)).resolves.toEqual({ state: 'already_resolved' });
  story.releaseAgent('permission-delivery');
  await expect(accepted).resolves.toEqual({ state: 'accepted' });
  story.releaseAgent('permission-turn');

  await story.waitForAgent('input-turn');
  await expect(session.respond(permissionResponse)).rejects.toMatchObject({
    fault: { code: 'revo.agent.interaction_unknown' },
  });
  await expect(
    session.respond({
      requestId: 'req_input',
      response: {
        kind: 'input',
        outcome: 'submitted',
        values: { retries: 0, targets: ['tests'] },
      },
    }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.interaction_invalid' } });
  const inputResponse = session.respond({
    requestId: 'req_input',
    response: {
      kind: 'input',
      outcome: 'submitted',
      values: { retries: 2, targets: ['tests', 'docs'] },
    },
  });
  await story.waitForAgent('input-delivery');
  story.releaseAgent('input-delivery');
  await expect(inputResponse).resolves.toEqual({ state: 'accepted' });
  story.releaseAgent('input-turn');

  await expect(turn.result()).resolves.toMatchObject({
    message: { content: 'All choices received.' },
    status: 'completed',
  });
  expect(story.eventTypes().filter((type) => type === 'interaction.requested')).toHaveLength(2);
  expect(story.eventTypes().filter((type) => type === 'interaction.resolved')).toHaveLength(2);
  expect(story.providerCalls().filter(({ type }) => type === 'interaction.respond')).toHaveLength(
    2,
  );
});

test('consumer cannot answer an unknown interaction request', async () => {
  const story = createAgentSessionStory({ replies: [] });
  const session = await story.open('dlg_unknown_interaction');

  await expect(
    session.respond({
      requestId: 'req_missing',
      response: { kind: 'permission', outcome: 'denied' },
    }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.interaction_unknown' } });
});
