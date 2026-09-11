import * as acp from '@agentclientprotocol/sdk';
import { expect, test } from 'vitest';

import { validateAgentDefinition } from '../../../src/definition/index.js';
import { createAcpConfigurationDriver } from '../../../src/protocol/acp/configuration-inspector.js';
import { ProtocolConfigurationError } from '../../../src/protocol/configuration-driver.js';
import { agentDefinition } from '../../support/builders/agent-definition.js';
import { transportPair } from '../../support/session/fakes/acp/transport.js';

const definition = validateAgentDefinition(agentDefinition()).definition;

const inspectWithSessionFailure = (failure: Error) => {
  const pair = transportPair();
  const connection = acp
    .agent({ name: 'configuration-failure-agent' })
    .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION }))
    .onRequest(acp.methods.agent.session.new, () => {
      throw failure;
    })
    .connect(pair.agent);
  const inspection = createAcpConfigurationDriver(() => undefined).inspect({
    activity: () => undefined,
    definition,
    transport: pair.client,
    workspace: '/workspace',
  });
  return { connection, inspection };
};

test('maps an ACP structured configuration reason and keeps its diagnostic details', async () => {
  const story = inspectWithSessionFailure(
    acp.RequestError.internalError({ error: { message: 'Provider configuration rejected.' } }),
  );
  try {
    await expect(story.inspection).rejects.toMatchObject({
      name: 'ProtocolConfigurationError',
      message: 'Provider configuration rejected.',
      details: {
        code: -32603,
        data: { error: { message: 'Provider configuration rejected.' } },
      },
    });
  } finally {
    story.connection.close();
  }
});

test('keeps an ordinary configuration transport failure at the ACP generic message', async () => {
  const story = inspectWithSessionFailure(new Error('private provider detail'));
  try {
    await expect(story.inspection).rejects.toBeInstanceOf(ProtocolConfigurationError);
    await expect(story.inspection).rejects.toMatchObject({
      message: 'Internal error',
    });
  } finally {
    story.connection.close();
  }
});
