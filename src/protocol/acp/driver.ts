import * as acp from '@agentclientprotocol/sdk';

import type { AgentUsage } from '../../contracts/manager/invocation.js';
import { protocolFailureDetails } from '../../diagnostics/diagnostic.js';
import type {
  ProtocolDriver,
  ProtocolOutcome,
  ProtocolSession,
  ProtocolSessionRequest,
} from '../driver.js';
import type { AcpProviderCompatibilityResolver } from './compatibility.js';
import { acpConfigurationRequester } from './configuration-requester.js';
import {
  AcpConfigurationSelectionError,
  acpClientCapabilities,
  applyAcpConfiguration,
} from './configuration.js';
import { boundAcpInput } from './frame-boundary.js';
import { AcpMcpCapabilityError, acpMcpServers } from './mcp.js';
import { acpPrompt } from './prompt.js';
import { AcpSessionFrameCapture } from './session-frame-capture.js';
import { normalizeAcpUsage } from './usage.js';

const maxAcpFrameBytes = 1_048_576;

/** A provider rejection after the channel was chosen fails once; there is no second channel. */
const failedOutcome = (error: unknown): ProtocolOutcome => {
  if (error instanceof AcpConfigurationSelectionError)
    return { status: 'failed', code: error.code };
  if (error instanceof AcpMcpCapabilityError)
    return { status: 'failed', code: 'revo.agent.parameters_invalid' };
  return { status: 'failed', diagnostic: protocolFailureDetails(error) };
};

/** Native session metadata is spread only when a channel was selected; omission stays byte-identical. */
const newSessionRequest = (
  request: ProtocolSessionRequest,
  capabilities: acp.AgentCapabilities | null | undefined,
): acp.NewSessionRequest => ({
  cwd: request.workspace,
  mcpServers: acpMcpServers(request.mcpServers, capabilities),
  ...(request.instructions?.sessionMeta === undefined
    ? {}
    : { _meta: request.instructions.sessionMeta }),
});

const finalResultPrompt = (schema: ProtocolSessionRequest['resultSchema']): acp.ContentBlock[] => [
  {
    type: 'text',
    text:
      'The task turn has finished. Do not call tools or repeat the task. Return exactly one JSON object matching the result schema, using the task results and instructions already in this session. No markdown or surrounding text. Result schema: ' +
      JSON.stringify(schema),
  },
];

const combinedUsage = (usages: readonly Required<AgentUsage>[]): Required<AgentUsage> =>
  normalizeAcpUsage(
    usages.reduce(
      (total, usage) => ({
        inputTokens: total.inputTokens + usage.inputTokens,
        outputTokens: total.outputTokens + usage.outputTokens,
        totalTokens: total.totalTokens + usage.totalTokens,
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    ),
  );

const runAcpInvocation = async (
  context: acp.ClientContext,
  request: ProtocolSessionRequest,
  compatibilityFor: AcpProviderCompatibilityResolver,
  capabilities: acp.AgentCapabilities | null | undefined,
  frames: AcpSessionFrameCapture,
  onSession: (session: acp.ActiveSession) => void,
  onResultTurn: () => boolean,
  isCancelled: () => boolean,
): Promise<ProtocolOutcome> => {
  const session = await context.buildSession(newSessionRequest(request, capabilities)).start();
  onSession(session);
  request.observer.activity();
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
  if (isCancelled()) return { status: 'completed' };
  let response = await session.prompt(acpPrompt(request));
  const usages: Required<AgentUsage>[] = [];
  if (request.definition.capabilities.usage && response.usage != null)
    usages.push(normalizeAcpUsage(response.usage));
  if (
    compatibilityFor(request.definition.id)?.finalResultTurn &&
    response.stopReason === 'end_turn' &&
    onResultTurn()
  ) {
    response = await session.prompt(finalResultPrompt(request.resultSchema));
    if (request.definition.capabilities.usage && response.usage != null)
      usages.push(normalizeAcpUsage(response.usage));
  }
  request.observer.activity();
  if (usages.length > 0) request.observer.usage(combinedUsage(usages));
  return { status: 'completed' };
};

const openAcpSession = async (
  request: ProtocolSessionRequest,
  compatibilityFor: AcpProviderCompatibilityResolver,
): Promise<ProtocolSession> => {
  const ready = Promise.withResolvers<acp.ClientContext>();
  const terminal = Promise.withResolvers<ProtocolOutcome>();
  const released = Promise.withResolvers<void>();
  let session: acp.ActiveSession | undefined;
  const compatibility = compatibilityFor(request.definition.id);
  let collectingResult = !compatibility?.finalResultTurn;
  let resultTurn = false;
  let cancelled = false;

  const frames = new AcpSessionFrameCapture();
  const stream = acp.ndJsonStream(
    request.transport.input,
    boundAcpInput(request.transport.output, maxAcpFrameBytes, frames.observe),
  );
  const connection = acp
    .client({ name: 'revo-agent-runtime' })
    .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
      request.observer.activity();
      const grant =
        !resultTurn && session?.sessionId === params.sessionId
          ? compatibility?.approveMcpPermission?.(
              params,
              request.permissions,
              request.mcpServers ?? [],
            )
          : undefined;
      if (grant !== undefined) return { outcome: { outcome: 'selected', optionId: grant } };
      if (resultTurn) return { outcome: { outcome: 'cancelled' } };
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
        collectingResult &&
        params.update.sessionUpdate === 'agent_message_chunk' &&
        params.update.content.type === 'text'
      ) {
        request.observer.resultChunk(new TextEncoder().encode(params.update.content.text));
      }
    })
    .connectWith(stream, async (context) => {
      const initialized = await context.request(acp.methods.agent.initialize, {
        clientCapabilities: acpClientCapabilities(),
        protocolVersion: acp.PROTOCOL_VERSION,
      });
      request.observer.activity();
      ready.resolve(context);
      let outcome: ProtocolOutcome;
      try {
        outcome = await runAcpInvocation(
          context,
          request,
          compatibilityFor,
          initialized.agentCapabilities,
          frames,
          (started) => {
            session = started;
          },
          () => {
            if (cancelled) return false;
            collectingResult = true;
            resultTurn = true;
            return true;
          },
          () => cancelled,
        );
      } catch (error) {
        outcome = failedOutcome(error);
      }
      terminal.resolve(outcome);
      await released.promise;
      session?.dispose();
    });

  void connection.catch((error: unknown) => {
    ready.reject(error);
    terminal.resolve({ status: 'failed' });
    released.resolve();
  });

  const context = await ready.promise;
  let close: Promise<void> | undefined;
  return Object.freeze({
    completion: terminal.promise,
    cancel: async (): Promise<void> => {
      cancelled = true;
      if (session === undefined) return;
      await context.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId });
    },
    close: (): Promise<void> => {
      close ??= (
        session === undefined
          ? Promise.resolve()
          : context
              .request(acp.methods.agent.session.close, { sessionId: session.sessionId })
              .then(() => {
                request.observer.activity();
              })
      ).finally(() => released.resolve());
      return close;
    },
  });
};

export const createAcpProtocolDriver = (
  compatibilityFor: AcpProviderCompatibilityResolver = () => undefined,
): ProtocolDriver =>
  Object.freeze({
    open: (request: ProtocolSessionRequest) => openAcpSession(request, compatibilityFor),
  });

export const acpProtocolDriver: ProtocolDriver = createAcpProtocolDriver();
