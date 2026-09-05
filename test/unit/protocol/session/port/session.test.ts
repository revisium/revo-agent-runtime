import { describe, expect, it } from 'vitest';

import { validateAgentDefinition } from '../../../../../src/definition/index.js';
import type { SessionProtocolUpdate } from '../../../../../src/protocol/session/model/update.js';
import { agentDefinition } from '../../../../support/builders/agent-definition.js';
import { createControllableSessionProtocolDriver } from '../../../../support/session/fakes/protocol/driver.js';

const definition = validateAgentDefinition(agentDefinition()).definition;
const capabilities = {
  cancellation: { prompt: true, session: true },
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;

const expectedUpdates = [
  { content: 'hello', type: 'message.delta' },
  { type: 'message.completed' },
  { message: 'working', type: 'progress' },
  {
    kind: 'search',
    status: 'started',
    title: 'Find references',
    toolCallId: 'tool-1',
    type: 'tool',
  },
  { items: [{ itemId: 'plan-1', status: 'in_progress', title: 'Inspect' }], type: 'plan' },
  { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
  {
    request: {
      kind: 'input',
      message: 'Choose modes',
      questions: [
        {
          allowOther: false,
          input: 'select',
          options: [
            { label: 'Fast', optionId: 'fast' },
            { label: 'Safe', optionId: 'safe' },
          ],
          questionId: 'modes',
          required: true,
          selection: 'multiple',
          title: 'Modes',
        },
      ],
      requestId: 'input-1',
    },
    type: 'interaction.requested',
  },
] as const satisfies readonly SessionProtocolUpdate[];

describe('portable hot session protocol', () => {
  it('normalizes updates and keeps prompt cancellation separate from session cleanup', async () => {
    const updates: SessionProtocolUpdate[] = [];
    const driver = createControllableSessionProtocolDriver({
      cancellations: [{ status: 'requested' }],
      checkpoints: [
        {
          continuation: { data: { sessionId: 'native-7' }, format: 'acp/v1' },
          status: 'captured',
        },
      ],
      closes: [{ status: 'closed' }],
      interactions: [{ status: 'accepted' }],
      openings: [{ kind: 'fresh', outcome: { capabilities, status: 'opened' }, steps: [] }],
      prompts: [
        {
          outcome: { status: 'completed', usage: { inputTokens: 3, outputTokens: 2 } },
          steps: [
            ...expectedUpdates.map((value) => ({ type: 'update' as const, value })),
            { barrier: 'turn-finished', type: 'wait' },
          ],
        },
      ],
    });
    const opening = driver.openFresh({
      definition,
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
        },
      },
      prompt: 'Inspect the project',
    });
    await driver.barriers.reached('turn-finished');
    expect(updates).toEqual(expectedUpdates);
    await expect(
      opened.session.respond({
        requestId: 'input-1',
        response: { kind: 'input', outcome: 'submitted', values: { modes: ['fast', 'safe'] } },
      }),
    ).resolves.toEqual({ status: 'accepted' });
    await expect(prompt.cancel('consumer request')).resolves.toEqual({ status: 'requested' });
    driver.barriers.release('turn-finished');
    await expect(prompt.completion).resolves.toEqual({
      status: 'completed',
      usage: { inputTokens: 3, outputTokens: 2 },
    });
    await expect(opened.session.checkpoint()).resolves.toEqual({
      continuation: { data: { sessionId: 'native-7' }, format: 'acp/v1' },
      status: 'captured',
    });
    await expect(opened.session.close('finished')).resolves.toEqual({ status: 'closed' });
    expect(driver.calls.map(({ type }) => type)).toEqual([
      'open.fresh',
      'prompt',
      'interaction.respond',
      'prompt.cancel',
      'checkpoint',
      'session.close',
    ]);
  });
});
