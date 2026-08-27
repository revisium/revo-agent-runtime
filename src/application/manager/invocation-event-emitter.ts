import {
  createIsoTimestamp,
  type TerminalPublicationAuthority,
  type TerminalPublicationPort,
} from '../../runtime/execution/index.js';
import type { AgentEvent, AgentExecutionPin } from '../../runtime/spec/index.js';
import type { TerminalSubscriptions } from './subscriptions.js';

type InvocationEventType = AgentEvent['type'];

export class InvocationEventEmitter {
  #sequence = 0;
  #chain: Promise<void> = Promise.resolve();
  #nonterminalAppendFailed = false;

  constructor(
    private readonly invocationId: string,
    private readonly pin: AgentExecutionPin,
    private readonly subscriptions: TerminalSubscriptions,
    private readonly output: TerminalPublicationPort,
    private readonly authority: TerminalPublicationAuthority,
  ) {}

  emit(
    type: Exclude<InvocationEventType, 'invocation.finished'>,
    timestamp = createIsoTimestamp(),
  ): void {
    this.#sequence += 1;
    const event: AgentEvent = Object.freeze({
      schemaVersion: 'agent-event/v1',
      type,
      invocationId: this.invocationId,
      pin: this.pin,
      sequence: this.#sequence,
      timestamp,
    });
    this.#chain = this.#chain.then(async () => {
      try {
        const appended = await this.output.appendLifecycleEvent(this.authority, event);
        if (appended.status === 'failed') this.#nonterminalAppendFailed = true;
      } catch {
        this.#nonterminalAppendFailed = true;
      }
    });
    this.subscriptions.deliver(event);
  }

  async settlePendingEvidence(): Promise<boolean> {
    await this.#chain;
    return this.#nonterminalAppendFailed;
  }

  async emitTerminal(timestamp = createIsoTimestamp()): Promise<void> {
    this.#sequence += 1;
    const event: AgentEvent = Object.freeze({
      schemaVersion: 'agent-event/v1',
      type: 'invocation.finished',
      invocationId: this.invocationId,
      pin: this.pin,
      sequence: this.#sequence,
      timestamp,
    });
    this.#chain = this.#chain.then(async () => {
      try {
        await this.output.appendLifecycleEvent(this.authority, event);
      } catch {
        // Terminal event persistence is best effort after the result commits.
      }
    });
    await this.#chain;
    this.subscriptions.deliver(event);
  }
}
