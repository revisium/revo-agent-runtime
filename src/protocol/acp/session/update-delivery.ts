import type * as acp from '@agentclientprotocol/sdk';

import type { SessionProtocolUpdate } from '../../session/model/update.js';
import type { SessionProtocolObserver } from '../../session/port/session.js';
import { deliverAcpSessionUpdate } from './mapping/updates.js';

/** Serializes notification delivery and exposes its completion fence. */
export class AcpSessionUpdateDelivery {
  readonly #tools = new Map<string, Extract<SessionProtocolUpdate, { readonly type: 'tool' }>>();
  #tail = Promise.resolve();

  constructor(private readonly observer: () => SessionProtocolObserver | undefined) {}

  startTurn(): void {
    this.#tools.clear();
  }

  deliver(update: acp.SessionUpdate): Promise<void> {
    const observer = this.observer();
    this.#tail = this.#tail.then(() => deliverAcpSessionUpdate(observer, update, this.#tools));
    // Keep failures observable to the completion fence without an unhandled rejection.
    void this.#tail.catch(() => undefined);
    return this.#tail;
  }

  whenIdle(): Promise<void> {
    return this.#tail;
  }
}
