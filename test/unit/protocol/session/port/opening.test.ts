import { describe, expect, it } from 'vitest';

import { validateAgentDefinition } from '../../../../../src/definition/index.js';
import type { SessionProtocolUpdate } from '../../../../../src/protocol/session/model/update.js';
import { agentDefinition } from '../../../../support/builders/agent-definition.js';
import { createControllableSessionProtocolDriver } from '../../../../support/session/fakes/protocol/driver.js';

const definition = validateAgentDefinition(
  agentDefinition({
    capabilities: {
      cancellation: true,
      session: {
        interactions: { input: true, permission: true },
        multiTurn: true,
        resume: 'native',
        updates: { message: true, plan: true, progress: true, tool: true, usage: true },
      },
      structuredResult: true,
      usage: true,
    },
  }),
).definition;

const transport = () => ({
  input: new WritableStream<Uint8Array>(),
  output: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
});

const capabilities = {
  cancellation: { prompt: true, session: true },
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;

describe('portable session protocol opening', () => {
  it('starts fresh only after process transport exists and supports opening interaction', async () => {
    const permission = {
      request: {
        action: { kind: 'edit' as const, title: 'Update source' },
        kind: 'permission' as const,
        options: [{ kind: 'allow_once' as const, label: 'Allow', optionId: 'allow' }],
        requestId: 'permission-1',
      },
      type: 'interaction.requested' as const,
    };
    const interactionObserved = Promise.withResolvers<void>();
    const updates: SessionProtocolUpdate[] = [];
    const driver = createControllableSessionProtocolDriver({
      interactions: [{ status: 'accepted' }],
      openings: [
        {
          kind: 'fresh',
          outcome: { capabilities, status: 'opened' },
          steps: [
            { barrier: 'fresh-handshake', type: 'wait' },
            { type: 'update', value: permission },
          ],
        },
      ],
    });

    const processTransport = transport();
    const opening = driver.openFresh({
      definition,
      kind: 'fresh',
      observer: {
        update: async (value) => {
          updates.push(value);
          interactionObserved.resolve();
        },
      },
      parameters: {},
      permissions: {},
      transport: processTransport,
      workspace: '/workspace',
    });

    await driver.barriers.reached('fresh-handshake');
    expect(driver.calls[0]).toMatchObject({ type: 'open.fresh' });
    expect(driver.calls[0]).toHaveProperty('request.transport', processTransport);

    driver.barriers.release('fresh-handshake');
    await interactionObserved.promise;
    await expect(
      opening.respond({
        requestId: 'permission-1',
        response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
      }),
    ).resolves.toEqual({ status: 'accepted' });
    await expect(opening.completion).resolves.toMatchObject({ capabilities, status: 'opened' });
    expect(updates).toEqual([permission]);
  });

  it('uses an explicit native continuation request for resume', async () => {
    const driver = createControllableSessionProtocolDriver({
      openings: [{ kind: 'resume', outcome: { capabilities, status: 'opened' }, steps: [] }],
    });
    const continuation = { data: { sessionId: 'native-7' }, format: 'acp/v1' } as const;

    const opening = driver.resume({
      continuation,
      definition,
      kind: 'resume',
      observer: { update: async () => undefined },
      parameters: {},
      permissions: {},
      transport: transport(),
      workspace: '/workspace',
    });

    await expect(opening.completion).resolves.toMatchObject({ status: 'opened' });
    expect(driver.calls[0]).toMatchObject({
      request: { continuation, kind: 'resume' },
      type: 'open.resume',
    });
  });
});
