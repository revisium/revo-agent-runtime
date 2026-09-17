import * as acp from '@agentclientprotocol/sdk';

import { protocolFailureDetails } from '../../session/errors/protocol-error.js';
import type {
  SessionProtocolCancellationOutcome,
  SessionProtocolCapabilities,
  SessionProtocolCheckpointOutcome,
  SessionProtocolCloseOutcome,
  SessionProtocolPromptOutcome,
} from '../../session/model/outcome.js';
import type {
  SessionProtocolInstructions,
  SessionProtocolInteractionResponseRequest,
} from '../../session/model/request.js';
import type {
  ObservedSessionProtocolPromptRequest,
  SessionProtocolPrompt,
  SessionProtocolSession,
  SessionProtocolObserver,
} from '../../session/port/session.js';
import { acpFailureMessage } from '../failure.js';
import { prefixInstructions } from '../instructions.js';
import { normalizeAcpUsage } from '../usage.js';
import { AcpSessionInteractionBroker } from './interaction/broker.js';

const protocolFailure = (message: string, error?: unknown) => ({
  code: 'transport_failed' as const,
  ...(error === undefined ? {} : { details: protocolFailureDetails(error) }),
  message: acpFailureMessage(error, message),
  retryable: false,
});

const promptOutcome = (response: acp.PromptResponse): SessionProtocolPromptOutcome => {
  if (response.stopReason === 'cancelled') return { status: 'cancelled' };
  try {
    return {
      status: 'completed',
      ...(response.usage == null ? {} : { usage: normalizeAcpUsage(response.usage) }),
    };
  } catch {
    return { failure: protocolFailure('ACP returned invalid usage.'), status: 'failed' };
  }
};

export interface AcpSessionResourceOptions {
  readonly broker: AcpSessionInteractionBroker;
  readonly capabilities: SessionProtocolCapabilities;
  readonly closeSupported: boolean;
  readonly context: acp.ClientContext;
  readonly instructions?: SessionProtocolInstructions;
  readonly providerSessionId: string;
  readonly release: () => void;
  readonly flushUpdates: () => Promise<void>;
  readonly setObserver: (observer: SessionProtocolObserver | undefined) => void;
}

/** Instructions travel across incarnations as identity and channel facts, never as text. */
const instructionsContinuation = (
  instructions: SessionProtocolInstructions | undefined,
  prefixDispatched: boolean,
) =>
  instructions === undefined
    ? {}
    : {
        instructionsDelivery: { mode: instructions.delivery.mode },
        instructionsDigest: instructions.digest,
        instructionsDispatched: prefixDispatched,
      };

export class AcpSessionResource implements SessionProtocolSession {
  #closing: Promise<SessionProtocolCloseOutcome> | undefined;
  #prefixDispatched: boolean;

  constructor(private readonly options: AcpSessionResourceOptions) {
    this.#prefixDispatched = options.instructions?.dispatched ?? false;
  }

  prompt(request: ObservedSessionProtocolPromptRequest): SessionProtocolPrompt {
    this.options.setObserver(request.observer);
    const completion: Promise<SessionProtocolPromptOutcome> = this.options.context
      .request(acp.methods.agent.session.prompt, {
        prompt: [{ text: this.#promptText(request.prompt), type: 'text' }],
        sessionId: this.options.providerSessionId,
      })
      .then(async (response) => {
        await this.options.flushUpdates();
        return promptOutcome(response);
      })
      .catch((error: unknown) => ({
        failure: protocolFailure('ACP prompt transport failed.', error),
        status: 'failed' as const,
      }))
      .finally(() => this.options.setObserver(undefined));
    return Object.freeze({
      cancel: (reason?: string) => this.#cancelPrompt(reason),
      completion,
    });
  }

  respond(request: SessionProtocolInteractionResponseRequest) {
    return Promise.resolve(this.options.broker.respond(request));
  }

  checkpoint(): Promise<SessionProtocolCheckpointOutcome> {
    if (this.options.capabilities.resume !== 'native')
      return Promise.resolve({
        failure: {
          code: 'capability_unsupported',
          message: 'ACP agent did not advertise native session resume.',
          retryable: false,
        },
        status: 'unsupported',
      });
    return Promise.resolve({
      continuation: {
        data: {
          sessionId: this.options.providerSessionId,
          ...instructionsContinuation(this.options.instructions, this.#prefixDispatched),
        },
        format: 'acp/v1',
      },
      status: 'captured',
    });
  }

  close(): Promise<SessionProtocolCloseOutcome> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  /** The prefix is attempted once per logical session: the first prompt of a fresh transcript. */
  #promptText(prompt: string): string {
    const instructions = this.options.instructions;
    if (
      instructions === undefined ||
      instructions.delivery.mode !== 'prompt_prefix' ||
      this.#prefixDispatched
    )
      return prompt;
    this.#prefixDispatched = true;
    return prefixInstructions(prompt, instructions.text);
  }

  async #cancelPrompt(_reason?: string): Promise<SessionProtocolCancellationOutcome> {
    this.options.broker.cancelPending();
    try {
      await this.options.context.notify(acp.methods.agent.session.cancel, {
        sessionId: this.options.providerSessionId,
      });
      return { status: 'requested' };
    } catch (error: unknown) {
      return {
        failure: protocolFailure('ACP prompt cancellation failed.', error),
        status: 'failed',
      };
    }
  }

  async #close(): Promise<SessionProtocolCloseOutcome> {
    this.options.broker.cancelPending();
    try {
      if (this.options.closeSupported)
        await this.options.context.request(acp.methods.agent.session.close, {
          sessionId: this.options.providerSessionId,
        });
      else
        await this.options.context.notify(acp.methods.agent.session.cancel, {
          sessionId: this.options.providerSessionId,
        });
      return { status: 'closed' };
    } catch (error: unknown) {
      return { failure: protocolFailure('ACP session close failed.', error), status: 'failed' };
    } finally {
      this.options.release();
    }
  }
}
