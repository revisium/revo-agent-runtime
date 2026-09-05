import * as acp from '@agentclientprotocol/sdk';

import type { AgentDefinitionSessionCapabilities } from '../../../contracts/agent-definition.js';
import type { AgentConfigurationSelection } from '../../../contracts/configuration.js';
import type { SessionProtocolOpeningOutcome } from '../../session/model/outcome.js';
import type { SessionProtocolContinuation } from '../../session/model/request.js';
import type {
  FreshSessionProtocolOpeningRequest,
  ResumeSessionProtocolOpeningRequest,
  SessionProtocolDriver,
} from '../../session/port/driver.js';
import type {
  SessionProtocolOpening,
  SessionProtocolOpeningResult,
} from '../../session/port/opening.js';
import type { SessionProtocolObserver } from '../../session/port/session.js';
import type { AcpConfigurationCompatibilityResolver } from '../compatibility.js';
import { acpConfigurationRequester } from '../configuration-requester.js';
import { AcpConfigurationSelectionError, applyAcpConfiguration } from '../configuration.js';
import { boundAcpInput } from '../frame-boundary.js';
import { AcpSessionFrameCapture } from '../session-frame-capture.js';
import { acpSessionClientCapabilities, negotiateAcpSessionCapabilities } from './capabilities.js';
import { AcpSessionInteractionBroker } from './interaction/broker.js';
import { AcpSessionResource } from './resource.js';
import { AcpSessionUpdateDelivery } from './update-delivery.js';

const maxAcpFrameBytes = 1_048_576;

type OpeningRequest = FreshSessionProtocolOpeningRequest | ResumeSessionProtocolOpeningRequest;

const failure = (
  code:
    | 'configuration_stale'
    | 'configuration_value_unsupported'
    | 'protocol_invalid'
    | 'transport_failed',
  message: string,
): Exclude<SessionProtocolOpeningOutcome, { readonly status: 'opened' }> => ({
  failure: { code, message, retryable: false },
  status: 'failed',
});

const connectionFailure = (error: unknown): SessionProtocolOpeningResult => {
  if (!(error instanceof AcpConfigurationSelectionError))
    return failure('transport_failed', 'ACP session transport failed.');
  const code =
    error.code === 'revo.agent.configuration_stale'
      ? 'configuration_stale'
      : 'configuration_value_unsupported';
  return failure(code, 'ACP configuration selection failed.');
};

const declaredCapabilities = (request: OpeningRequest): AgentDefinitionSessionCapabilities => {
  const declared = request.definition.capabilities.session;
  if (declared === undefined) throw new Error('ACP session definition lacks session capability.');
  return declared;
};

const continuationSessionId = (continuation: SessionProtocolContinuation): string | undefined => {
  if (continuation.format !== 'acp/v1') return undefined;
  const value = continuation.data.sessionId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const applyConfiguration = async (
  context: acp.ClientContext,
  providerSessionId: string,
  options: readonly acp.SessionConfigOption[] | null | undefined,
  selection: AgentConfigurationSelection | undefined,
  compatibilityFor: AcpConfigurationCompatibilityResolver,
  definitionId: string,
  frame: Readonly<Record<string, unknown>> | undefined,
): Promise<void> => {
  await applyAcpConfiguration(
    acpConfigurationRequester(context),
    { configOptions: options ?? [], sessionId: providerSessionId },
    selection,
    compatibilityFor(definitionId),
    frame,
  );
};

const openAcpSession = (
  request: OpeningRequest,
  compatibilityFor: AcpConfigurationCompatibilityResolver,
): SessionProtocolOpening => {
  const completion = Promise.withResolvers<SessionProtocolOpeningResult>();
  const released = Promise.withResolvers<void>();
  const frames = new AcpSessionFrameCapture();
  let observer: SessionProtocolObserver | undefined = request.observer;
  let resource: AcpSessionResource | undefined;
  let providerSessionId: string | undefined;
  let settled = false;
  const declared = declaredCapabilities(request);
  const belongsToSession = (sessionId: unknown): boolean =>
    providerSessionId !== undefined && sessionId === providerSessionId;
  const broker = new AcpSessionInteractionBroker(() => observer, declared.interactions);
  const updates = new AcpSessionUpdateDelivery(() => observer);
  const stream = acp.ndJsonStream(
    request.transport.input,
    boundAcpInput(request.transport.output, maxAcpFrameBytes, frames.observe),
  );
  const connection = acp
    .client({ name: 'revo-agent-runtime' })
    // Register updates first: SDK request-handler dispatch yields between handlers.
    // Admission must precede a following prompt response; delivery is fenced separately.
    .onNotification(acp.methods.client.session.update, async ({ params }) => {
      if (belongsToSession(params.sessionId)) await updates.deliver(params.update);
    })
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) =>
      belongsToSession(params.sessionId)
        ? broker.permission(params)
        : { outcome: { outcome: 'cancelled' } },
    )
    .onRequest(acp.methods.client.elicitation.create, ({ params }) =>
      'sessionId' in params &&
      typeof params.sessionId === 'string' &&
      belongsToSession(params.sessionId)
        ? broker.elicitation(params)
        : { action: 'cancel' },
    )
    .connectWith(stream, async (context) => {
      const initialized = await context.request(acp.methods.agent.initialize, {
        clientCapabilities: acpSessionClientCapabilities(),
        protocolVersion: acp.PROTOCOL_VERSION,
      });
      const capabilities = negotiateAcpSessionCapabilities(
        declared,
        initialized.agentCapabilities,
        request.definition.capabilities.cancellation,
      );
      let configOptions: readonly acp.SessionConfigOption[] | null | undefined;
      if ('continuation' in request) {
        providerSessionId = continuationSessionId(request.continuation);
        if (providerSessionId === undefined || capabilities.resume !== 'native') {
          completion.resolve({
            failure: {
              code: 'capability_unsupported',
              message: 'ACP native session resume is unavailable.',
              retryable: false,
            },
            status: 'unsupported',
          });
          released.resolve();
          return;
        }
        const response = await context.request(acp.methods.agent.session.resume, {
          cwd: request.workspace,
          mcpServers: [],
          sessionId: providerSessionId,
        });
        configOptions = response.configOptions;
      } else {
        const response = await context.request(acp.methods.agent.session.new, {
          cwd: request.workspace,
          mcpServers: [],
        });
        providerSessionId = response.sessionId;
        configOptions = response.configOptions;
      }
      await applyConfiguration(
        context,
        providerSessionId,
        configOptions,
        request.configuration,
        compatibilityFor,
        request.definition.id,
        frames.sessionResponse(),
      );
      resource = new AcpSessionResource({
        broker,
        capabilities,
        closeSupported: initialized.agentCapabilities?.sessionCapabilities?.close != null,
        context,
        providerSessionId,
        flushUpdates: () => updates.whenIdle(),
        setObserver: (next) => {
          if (next !== undefined) updates.startTurn();
          observer = next;
        },
        release: released.resolve,
      });
      settled = true;
      completion.resolve({ capabilities, session: resource, status: 'opened' });
      await released.promise;
    });
  void connection.catch((error: unknown) => {
    broker.cancelPending();
    released.resolve();
    if (settled) return;
    settled = true;
    completion.resolve(connectionFailure(error));
  });
  return Object.freeze({
    close: (): ReturnType<SessionProtocolOpening['close']> => {
      if (resource !== undefined) return resource.close();
      released.resolve();
      return Promise.resolve({ status: 'closed' as const });
    },
    completion: completion.promise,
    respond: (response: Parameters<SessionProtocolOpening['respond']>[0]) =>
      Promise.resolve(broker.respond(response)),
  });
};

export const createAcpSessionProtocolDriver = (
  compatibilityFor: AcpConfigurationCompatibilityResolver = () => undefined,
): SessionProtocolDriver =>
  Object.freeze({
    openFresh: (request: FreshSessionProtocolOpeningRequest) =>
      openAcpSession(request, compatibilityFor),
    resume: (request: ResumeSessionProtocolOpeningRequest) =>
      openAcpSession(request, compatibilityFor),
  });
