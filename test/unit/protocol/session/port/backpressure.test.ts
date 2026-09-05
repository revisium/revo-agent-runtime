import { expect, it } from 'vitest';

import { validateAgentDefinition } from '../../../../../src/definition/index.js';
import type { SessionProtocolUpdate } from '../../../../../src/protocol/session/model/update.js';
import { agentDefinition } from '../../../../support/builders/agent-definition.js';
import { createControllableSessionProtocolDriver } from '../../../../support/session/fakes/protocol/driver.js';

const capabilities = {
  cancellation: { prompt: true, session: true },
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;

it('awaits observer delivery before advancing the scripted provider', async () => {
  const firstUpdateObserved = Promise.withResolvers<void>();
  const continueDelivery = Promise.withResolvers<void>();
  const updates: SessionProtocolUpdate[] = [];
  const driver = createControllableSessionProtocolDriver({
    openings: [{ kind: 'fresh', outcome: { capabilities, status: 'opened' }, steps: [] }],
    prompts: [
      {
        outcome: { status: 'completed' },
        steps: [
          { type: 'update', value: { content: 'first', type: 'message.delta' } },
          { type: 'update', value: { content: 'second', type: 'message.delta' } },
        ],
      },
    ],
  });
  const opening = driver.openFresh({
    definition: validateAgentDefinition(agentDefinition()).definition,
    kind: 'fresh',
    observer: { update: async () => undefined },
    parameters: {},
    permissions: {},
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    },
    workspace: '/workspace',
  });
  const opened = await opening.completion;
  if (opened.status !== 'opened') throw new Error('Expected fake session to open');

  const prompt = opened.session.prompt({
    observer: {
      update: async (value) => {
        updates.push(value);
        if (updates.length === 1) {
          firstUpdateObserved.resolve();
          await continueDelivery.promise;
        }
      },
    },
    prompt: 'Stream updates',
  });
  await firstUpdateObserved.promise;
  expect(updates).toHaveLength(1);
  continueDelivery.resolve();

  await expect(prompt.completion).resolves.toEqual({ status: 'completed' });
  expect(updates).toEqual([
    { content: 'first', type: 'message.delta' },
    { content: 'second', type: 'message.delta' },
  ]);
});
