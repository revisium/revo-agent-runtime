import { describe, expect, it } from 'vitest';

import { validateAgentDefinition } from '../../../../../src/definition/index.js';
import { agentDefinition } from '../../../../support/builders/agent-definition.js';
import { createControllableSessionProtocolDriver } from '../../../../support/session/fakes/protocol/driver.js';

const failure = {
  code: 'capability_unsupported',
  message: 'Native continuation is unavailable.',
  retryable: false,
} as const;

const openingRequest = () => ({
  definition: validateAgentDefinition(agentDefinition()).definition,
  kind: 'fresh' as const,
  observer: { update: async () => undefined },
  parameters: {},
  permissions: {},
  transport: {
    input: new WritableStream<Uint8Array>(),
    output: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
  },
  workspace: '/workspace',
});

describe('portable session protocol outcomes', () => {
  it('preserves an unsupported opening as a bounded outcome', async () => {
    const driver = createControllableSessionProtocolDriver({
      openings: [{ kind: 'fresh', outcome: { failure, status: 'unsupported' }, steps: [] }],
    });

    await expect(driver.openFresh(openingRequest()).completion).resolves.toEqual({
      failure,
      status: 'unsupported',
    });
  });

  it('preserves rejected and failed lifecycle outcomes without throwing', async () => {
    const capabilities = {
      cancellation: { prompt: false, session: true },
      interactions: { input: false, permission: false },
      multiTurn: true,
      resume: 'none',
      updates: { message: true, plan: false, progress: false, tool: false, usage: false },
    } as const;
    const driver = createControllableSessionProtocolDriver({
      cancellations: [{ status: 'unsupported' }],
      checkpoints: [{ failure, status: 'unsupported' }],
      closes: [{ failure, status: 'failed' }],
      interactions: [{ failure, status: 'rejected' }],
      openings: [{ kind: 'fresh', outcome: { capabilities, status: 'opened' }, steps: [] }],
      prompts: [{ outcome: { failure, status: 'failed' }, steps: [] }],
    });
    const opened = await driver.openFresh(openingRequest()).completion;
    if (opened.status !== 'opened') throw new Error('Expected fake session to open');

    const prompt = opened.session.prompt({
      observer: { update: async () => undefined },
      prompt: 'Unsupported operations',
    });
    await expect(prompt.completion).resolves.toEqual({ failure, status: 'failed' });
    await expect(prompt.cancel()).resolves.toEqual({ status: 'unsupported' });
    await expect(
      opened.session.respond({
        requestId: 'permission-1',
        response: { kind: 'permission', outcome: 'denied' },
      }),
    ).resolves.toEqual({ failure, status: 'rejected' });
    await expect(opened.session.checkpoint()).resolves.toEqual({
      failure,
      status: 'unsupported',
    });
    await expect(opened.session.close()).resolves.toEqual({ failure, status: 'failed' });
  });
});
