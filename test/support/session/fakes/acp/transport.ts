import * as acp from '@agentclientprotocol/sdk';

const coalescingOutput = (output: WritableStream<Uint8Array>): WritableStream<acp.AnyMessage> => {
  const writer = output.getWriter();
  const pending: acp.AnyMessage[] = [];
  return new WritableStream<acp.AnyMessage>({
    write: async (frame) => {
      pending.push(frame);
      if ('method' in frame && frame.method === 'session/update') return;
      const bytes = new TextEncoder().encode(
        `${pending.map((value) => JSON.stringify(value)).join('\n')}\n`,
      );
      pending.length = 0;
      await writer.write(bytes);
    },
  });
};

export const transportPair = (options: { readonly coalescedUpdates?: boolean } = {}) => {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  const agent =
    options.coalescedUpdates === true
      ? {
          readable: acp.ndJsonStream(new WritableStream(), clientToAgent.readable).readable,
          writable: coalescingOutput(agentToClient.writable),
        }
      : acp.ndJsonStream(agentToClient.writable, clientToAgent.readable);
  return {
    agent,
    client: { input: clientToAgent.writable, output: agentToClient.readable },
  };
};
