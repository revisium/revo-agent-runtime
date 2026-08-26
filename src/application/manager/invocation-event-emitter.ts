import { createIsoTimestamp } from '../../runtime/execution/index.js';
import type { AgentEvent, AgentExecutionPin } from '../../runtime/spec/index.js';
import type { TerminalSubscriptions } from './subscriptions.js';

type InvocationEventType = AgentEvent['type'];

export class InvocationEventEmitter {
  #sequence = 0;

  constructor(
    private readonly invocationId: string,
    private readonly pin: AgentExecutionPin,
    private readonly subscriptions: TerminalSubscriptions,
  ) {}

  emit(type: InvocationEventType, timestamp = createIsoTimestamp()): void {
    this.#sequence += 1;
    const event: AgentEvent = Object.freeze({
      schemaVersion: 'agent-event/v1',
      type,
      invocationId: this.invocationId,
      pin: this.pin,
      sequence: this.#sequence,
      timestamp,
    });
    this.subscriptions.deliver(event);
  }
}
