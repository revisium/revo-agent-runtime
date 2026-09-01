export const packedFakeAcpBridge = `
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

acp
  .agent({ name: 'packed-consumer-fake' })
  .onRequest(acp.methods.agent.initialize, () => ({
    agentCapabilities: { sessionCapabilities: { close: {} } },
    protocolVersion: acp.PROTOCOL_VERSION,
  }))
  .onRequest(acp.methods.agent.session.new, () => ({
    configOptions: [{
      category: 'model',
      currentValue: 'packed/model',
      id: 'model',
      name: 'Model',
      options: [{ name: 'Packed model', value: 'packed/model' }],
      type: 'select',
    }],
    sessionId: 'packed-session',
  }))
  .onRequest(acp.methods.agent.session.setConfigOption, () => ({
    configOptions: [{
      category: 'model',
      currentValue: 'packed/model',
      id: 'model',
      name: 'Model',
      options: [{ name: 'Packed model', value: 'packed/model' }],
      type: 'select',
    }],
  }))
  .onRequest(acp.methods.agent.session.prompt, async (context) => {
    await context.client.notify(acp.methods.client.session.update, {
      sessionId: context.params.sessionId,
      update: {
        content: { text: '{"answer":"packed consumer"}', type: 'text' },
        sessionUpdate: 'agent_message_chunk',
      },
    });
    return { stopReason: 'end_turn' };
  })
  .onRequest(acp.methods.agent.session.close, () => ({}))
  .connect(stream);
`;
