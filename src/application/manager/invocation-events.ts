import type {
  AgentEvent,
  AgentExecutionPin,
  AgentInvocationResult,
  StartAgentInvocation,
} from '../../contracts/manager.js';
import type { ActiveStateReservation } from '../active-state/reservation.js';
import type { InvocationResultTiming } from '../result/invocation-result.js';
import { EventSubscriptions, lifecycleEvent } from './events.js';
import type { InvocationQueries } from './invocation-queries.js';

/** Owns the ordered public lifecycle observations for one invocation. */
export class InvocationEvents {
  private readonly publishedEvents: AgentEvent[] = [];
  private sequence = 0;
  private publiclyAccepted = false;
  private cancellationObserved = false;
  private startedAt: string | undefined;
  private activeState: ActiveStateReservation | undefined;

  constructor(
    private readonly invocationId: string,
    private readonly pin: AgentExecutionPin,
    private readonly queries: InvocationQueries,
    private readonly subscriptions: EventSubscriptions,
  ) {}

  readonly onCancelling = (): void => {
    this.cancellationObserved = true;
    this.activeState?.observeCancelling();
    if (!this.publiclyAccepted) return;
    this.queries.markCancelling(this.invocationId);
    this.publish(
      lifecycleEvent('invocation.cancelling', this.invocationId, this.pin, ++this.sequence),
    );
  };

  readonly onStarted = (): void => {
    if (!this.publiclyAccepted) return;
    const event = lifecycleEvent(
      'invocation.started',
      this.invocationId,
      this.pin,
      ++this.sequence,
    );
    this.startedAt = event.timestamp;
    this.queries.markStarted(this.invocationId, event.timestamp);
    this.publish(event);
  };

  bindActiveState(activeState: ActiveStateReservation): void {
    this.activeState = activeState;
    if (this.cancellationObserved) activeState.observeCancelling();
  }

  accept(request: StartAgentInvocation, result: Promise<AgentInvocationResult>): AgentEvent {
    this.publiclyAccepted = true;
    this.sequence = 1;
    const event = lifecycleEvent('invocation.accepted', this.invocationId, this.pin, this.sequence);
    this.queries.accept(request, this.pin, event.timestamp, result);
    return event;
  }

  publishAccepted(event: AgentEvent): void {
    this.publish(event);
  }

  finish(): AgentEvent {
    return lifecycleEvent('invocation.finished', this.invocationId, this.pin, ++this.sequence);
  }

  timing(acceptedAt: string): Omit<InvocationResultTiming, 'finishedAt'> {
    return Object.freeze({
      acceptedAt,
      ...(this.startedAt === undefined ? {} : { startedAt: this.startedAt }),
    });
  }

  priorEvents(): readonly AgentEvent[] {
    return this.publishedEvents;
  }

  private publish(event: AgentEvent): void {
    this.publishedEvents.push(event);
    this.subscriptions.publish(event);
  }
}
