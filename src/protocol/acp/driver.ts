import * as acp from '@agentclientprotocol/sdk';

import type {
  ProtocolDriver,
  ProtocolOutcome,
  ProtocolSession,
  ProtocolSessionRequest,
} from '../driver.js';
import type { AcpConfigurationCompatibilityResolver } from './compatibility.js';
import { acpConfigurationRequester } from './configuration-requester.js';
import {
  AcpConfigurationSelectionError,
  acpClientCapabilities,
  applyAcpConfiguration,
} from './configuration.js';
import { boundAcpInput } from './frame-boundary.js';
import { acpPrompt } from './prompt.js';
import { AcpSessionFrameCapture } from './session-frame-capture.js';
import { normalizeAcpUsage } from './usage.js';

const maxAcpFrameBytes = 1_048_576;

const openAcpSession = async (
  request: ProtocolSessionRequest,
  compatibilityFor: AcpConfigurationCompatibilityResolver,
): Promise<ProtocolSession> => {
  const ready = Promise.withResolvers<{
    readonly context: acp.ClientContext;
    readonly session: acp.ActiveSession;
  }>();
  const terminal = Promise.withResolvers<ProtocolOutcome>();
  const released = Promise.withResolvers<void>();

  const frames = new AcpSessionFrameCapture();
  const stream = acp.ndJsonStream(
    request.transport.input,
    boundAcpInput(request.transport.output, maxAcpFrameBytes, frames.observe),
  );
  const connection = acp
    .client({ name: 'revo-agent-runtime' })
    .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
      request.observer.activity();
      const decision = await request.observer.permission({
        options: params.options.map((option) => ({ id: option.optionId, kind: option.kind })),
      });
      return decision.outcome === 'selected'
        ? { outcome: { optionId: decision.optionId, outcome: 'selected' } }
        : { outcome: { outcome: 'cancelled' } };
    })
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      request.observer.activity();
      if (
        params.update.sessionUpdate === 'agent_message_chunk' &&
        params.update.content.type === 'text'
      ) {
        request.observer.resultChunk(new TextEncoder().encode(params.update.content.text));
      }
    })
    .connectWith(stream, async (context) => {
      await context.request(acp.methods.agent.initialize, {
        clientCapabilities: acpClientCapabilities(),
        protocolVersion: acp.PROTOCOL_VERSION,
      });
      request.observer.activity();
      const session = await context.buildSession(request.workspace).start();
      request.observer.activity();
      ready.resolve({ context, session });
      try {
        try {
          await applyAcpConfiguration(
            acpConfigurationRequester(context),
            {
              configOptions: session.newSessionResponse.configOptions ?? [],
              sessionId: session.sessionId,
            },
            request.configuration,
            compatibilityFor(request.definition.id),
            frames.sessionResponse(),
          );
        } catch (error) {
          terminal.resolve({
            status: 'failed',
            ...(error instanceof AcpConfigurationSelectionError ? { code: error.code } : {}),
          });
          await released.promise;
          return;
        }
        const response = await session.prompt(acpPrompt(request));
        request.observer.activity();
        if (request.definition.capabilities.usage && response.usage != null)
          request.observer.usage(normalizeAcpUsage(response.usage));
        terminal.resolve({ status: 'completed' });
        await released.promise;
      } finally {
        session.dispose();
      }
    });

  void connection.catch((error: unknown) => {
    ready.reject(error);
    terminal.resolve({ status: 'failed' });
    released.resolve();
  });

  const established = await ready.promise;
  let close: Promise<void> | undefined;
  return Object.freeze({
    completion: terminal.promise,
    cancel: async (): Promise<void> => {
      await established.context.notify(acp.methods.agent.session.cancel, {
        sessionId: established.session.sessionId,
      });
    },
    close: (): Promise<void> => {
      close ??= established.context
        .request(acp.methods.agent.session.close, { sessionId: established.session.sessionId })
        .then(() => {
          request.observer.activity();
        })
        .finally(() => released.resolve());
      return close;
    },
  });
};

export const createAcpProtocolDriver = (
  compatibilityFor: AcpConfigurationCompatibilityResolver = () => undefined,
): ProtocolDriver =>
  Object.freeze({
    open: (request: ProtocolSessionRequest) => openAcpSession(request, compatibilityFor),
  });

export const acpProtocolDriver: ProtocolDriver = createAcpProtocolDriver();
