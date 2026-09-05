import type * as acp from '@agentclientprotocol/sdk';

import type { SessionProtocolInteractionOutcome } from '../../../session/model/outcome.js';
import type { SessionProtocolInteractionResponseRequest } from '../../../session/model/request.js';
import type { SessionProtocolInteractionRequest } from '../../../session/model/update.js';
import type { SessionProtocolObserver } from '../../../session/port/session.js';
import { mapAcpElicitationRequest, mapAcpPermissionRequest } from './mapping.js';

type PendingInteraction =
  | {
      readonly kind: 'permission';
      readonly complete: (response: acp.RequestPermissionResponse) => void;
    }
  | {
      readonly kind: 'input';
      readonly complete: (response: acp.CreateElicitationResponse) => void;
    };

const failed = (): SessionProtocolInteractionOutcome => ({
  failure: {
    code: 'interaction_rejected',
    message: 'ACP interaction response could not be applied.',
    retryable: false,
  },
  status: 'failed',
});

export class AcpSessionInteractionBroker {
  readonly #pending = new Map<string, PendingInteraction>();
  #sequence = 0;

  constructor(
    private readonly observer: () => SessionProtocolObserver | undefined,
    private readonly supported: Readonly<{ input: boolean; permission: boolean }>,
  ) {}

  async permission(request: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    if (!this.supported.permission) return { outcome: { outcome: 'cancelled' } };
    const requestId = this.#nextId();
    const answer = Promise.withResolvers<acp.RequestPermissionResponse>();
    this.#pending.set(requestId, { complete: answer.resolve, kind: 'permission' });
    try {
      await this.#publish(mapAcpPermissionRequest(requestId, request));
      return await answer.promise;
    } finally {
      this.#pending.delete(requestId);
    }
  }

  async elicitation(request: acp.CreateElicitationRequest): Promise<acp.CreateElicitationResponse> {
    if (!this.supported.input) return { action: 'cancel' };
    const mapped = mapAcpElicitationRequest(this.#nextId(), request);
    if (mapped === undefined) return { action: 'cancel' };
    const answer = Promise.withResolvers<acp.CreateElicitationResponse>();
    this.#pending.set(mapped.requestId, { complete: answer.resolve, kind: 'input' });
    try {
      await this.#publish(mapped);
      return await answer.promise;
    } finally {
      this.#pending.delete(mapped.requestId);
    }
  }

  respond(request: SessionProtocolInteractionResponseRequest): SessionProtocolInteractionOutcome {
    const pending = this.#pending.get(request.requestId);
    if (pending?.kind !== request.response.kind) return failed();
    if (pending.kind === 'permission' && request.response.kind === 'permission') {
      pending.complete({
        outcome:
          request.response.outcome === 'selected'
            ? {
                optionId: request.response.optionId,
                outcome: 'selected',
              }
            : { outcome: 'cancelled' },
      });
      return { status: 'accepted' };
    }
    if (pending.kind === 'input' && request.response.kind === 'input') {
      pending.complete(
        request.response.outcome === 'submitted'
          ? { action: 'accept', content: structuredClone(request.response.values) }
          : { action: request.response.outcome === 'declined' ? 'decline' : 'cancel' },
      );
      return { status: 'accepted' };
    }
    return failed();
  }

  cancelPending(): void {
    for (const pending of this.#pending.values()) {
      if (pending.kind === 'permission') pending.complete({ outcome: { outcome: 'cancelled' } });
      else pending.complete({ action: 'cancel' });
    }
    this.#pending.clear();
  }

  async #publish(request: SessionProtocolInteractionRequest): Promise<void> {
    const observer = this.observer();
    if (observer === undefined) throw new Error('ACP interaction has no active session observer.');
    await observer.update({ request, type: 'interaction.requested' });
  }

  #nextId(): string {
    this.#sequence += 1;
    return `req_acp_${this.#sequence}`;
  }
}
