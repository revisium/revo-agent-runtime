import * as acp from '@agentclientprotocol/sdk';

import type {
  SessionProtocolCancellationOutcome,
  SessionProtocolCapabilities,
  SessionProtocolCheckpointOutcome,
  SessionProtocolCloseOutcome,
  SessionProtocolPromptOutcome,
} from '../../session/model/outcome.js';
import type { SessionProtocolInteractionResponseRequest } from '../../session/model/request.js';
import type {
  ObservedSessionProtocolPromptRequest,
  SessionProtocolPrompt,
  SessionProtocolSession,
} from '../../session/port/session.js';
import { normalizeAcpUsage } from '../usage.js';
import { AcpSessionInteractionBroker } from './interaction/broker.js';

const protocolFailure = (message: string) => ({
  code: 'transport_failed' as const,
  message,
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
  readonly providerSessionId: string;
  readonly release: () => void;
  readonly setObserver: (
    observer: ObservedSessionProtocolPromptRequest['observer'] | undefined,
  ) => void;
}

export class AcpSessionResource implements SessionProtocolSession {
  #closing: Promise<SessionProtocolCloseOutcome> | undefined;

  constructor(private readonly options: AcpSessionResourceOptions) {}

  prompt(request: ObservedSessionProtocolPromptRequest): SessionProtocolPrompt {
    this.options.setObserver(request.observer);
    const completion: Promise<SessionProtocolPromptOutcome> = this.options.context
      .request(acp.methods.agent.session.prompt, {
        prompt: [{ text: request.prompt, type: 'text' }],
        sessionId: this.options.providerSessionId,
      })
      .then(promptOutcome, () => ({
        failure: protocolFailure('ACP prompt transport failed.'),
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
        data: { sessionId: this.options.providerSessionId },
        format: 'acp/v1',
      },
      status: 'captured',
    });
  }

  close(): Promise<SessionProtocolCloseOutcome> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #cancelPrompt(_reason?: string): Promise<SessionProtocolCancellationOutcome> {
    this.options.broker.cancelPending();
    try {
      await this.options.context.notify(acp.methods.agent.session.cancel, {
        sessionId: this.options.providerSessionId,
      });
      return { status: 'requested' };
    } catch {
      return { failure: protocolFailure('ACP prompt cancellation failed.'), status: 'failed' };
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
    } catch {
      return { failure: protocolFailure('ACP session close failed.'), status: 'failed' };
    } finally {
      this.options.release();
    }
  }
}
