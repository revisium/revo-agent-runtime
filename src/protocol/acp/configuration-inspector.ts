import * as acp from '@agentclientprotocol/sdk';

import type {
  ProtocolConfigurationDriver,
  ProtocolConfigurationSession,
  ProtocolConfigurationRequest,
} from '../configuration-driver.js';
import type { AcpConfigurationCompatibilityResolver } from './compatibility.js';
import { acpConfigurationRequester } from './configuration-requester.js';
import { acpClientCapabilities, applyAcpConfiguration } from './configuration.js';
import { boundAcpInput } from './frame-boundary.js';
import { AcpSessionFrameCapture } from './session-frame-capture.js';

const maxAcpFrameBytes = 1_048_576;

const inspectAcpConfiguration = async (
  request: ProtocolConfigurationRequest,
  compatibilityFor: AcpConfigurationCompatibilityResolver,
): Promise<ProtocolConfigurationSession> => {
  const ready = Promise.withResolvers<{
    readonly catalog: Awaited<ReturnType<typeof applyAcpConfiguration>>;
    readonly context: acp.ClientContext;
    readonly session: acp.ActiveSession;
  }>();
  const released = Promise.withResolvers<void>();
  const frames = new AcpSessionFrameCapture();
  const stream = acp.ndJsonStream(
    request.transport.input,
    boundAcpInput(request.transport.output, maxAcpFrameBytes, frames.observe),
  );
  const connection = acp
    .client({ name: 'revo-agent-runtime' })
    .connectWith(stream, async (context) => {
      await context.request(acp.methods.agent.initialize, {
        clientCapabilities: acpClientCapabilities(),
        protocolVersion: acp.PROTOCOL_VERSION,
      });
      request.activity();
      const session = await context.buildSession(request.workspace).start();
      request.activity();
      try {
        ready.resolve({
          catalog: await applyAcpConfiguration(
            acpConfigurationRequester(context),
            {
              configOptions: session.newSessionResponse.configOptions ?? [],
              sessionId: session.sessionId,
            },
            undefined,
            compatibilityFor(request.definition.id),
            frames.sessionResponse(),
          ),
          context,
          session,
        });
        await released.promise;
      } finally {
        session.dispose();
      }
    });
  void connection.catch((error: unknown) => {
    ready.reject(error);
    released.resolve();
  });
  const inspected = await ready.promise;
  let close: Promise<void> | undefined;
  return Object.freeze({
    catalog: inspected.catalog,
    close: (): Promise<void> => {
      close ??= inspected.context
        .request(acp.methods.agent.session.close, { sessionId: inspected.session.sessionId })
        .then(request.activity)
        .finally(() => released.resolve());
      return close;
    },
  });
};

export const createAcpConfigurationDriver = (
  compatibilityFor: AcpConfigurationCompatibilityResolver,
): ProtocolConfigurationDriver =>
  Object.freeze({
    inspect: (request: ProtocolConfigurationRequest) =>
      inspectAcpConfiguration(request, compatibilityFor),
  });
