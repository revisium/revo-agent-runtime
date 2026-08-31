import type {
  AgentEvent,
  AgentEventFilter,
  AgentEventListener,
  AgentExecutionPin,
  Unsubscribe,
} from '../../contracts/manager.js';
import { managerError } from '../faults/agent-faults.js';
import { readClosedArray, readDataProperty, readExactAgentRef } from './public-filter-input.js';

interface Subscription {
  readonly filter: AgentEventFilter;
  readonly listener: AgentEventListener;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const eventTypes = new Set<string>([
  'invocation.accepted',
  'invocation.started',
  'invocation.cancelling',
  'invocation.finished',
]);

const isEventType = (value: unknown): value is AgentEvent['type'] =>
  typeof value === 'string' && eventTypes.has(value);

const readFilter = (value: unknown): AgentEventFilter | undefined => {
  try {
    if (
      !isRecord(value) ||
      Reflect.ownKeys(value).some(
        (key) => key !== 'agent' && key !== 'invocationId' && key !== 'types',
      )
    )
      return undefined;
    const invocationIdProperty = readDataProperty(value, 'invocationId');
    const agentProperty = readDataProperty(value, 'agent');
    const typesProperty = readDataProperty(value, 'types');
    const agent =
      agentProperty.status === 'present' ? readExactAgentRef(agentProperty.value) : undefined;
    const types =
      typesProperty.status === 'present'
        ? readClosedArray(typesProperty.value, isEventType)
        : undefined;
    const invocationId =
      invocationIdProperty.status === 'present' ? invocationIdProperty.value : undefined;
    if (
      invocationIdProperty.status === 'invalid' ||
      agentProperty.status === 'invalid' ||
      typesProperty.status === 'invalid' ||
      (invocationIdProperty.status === 'present' && typeof invocationId !== 'string') ||
      (agentProperty.status === 'present' && agent === undefined) ||
      (typesProperty.status === 'present' && types === undefined)
    )
      return undefined;
    return Object.freeze({
      ...(agent === undefined ? {} : { agent }),
      ...(typeof invocationId === 'string' ? { invocationId } : {}),
      ...(types === undefined ? {} : { types }),
    });
  } catch {
    return undefined;
  }
};

export const lifecycleEvent = (
  type: AgentEvent['type'],
  invocationId: string,
  pin: AgentExecutionPin,
  sequence: number,
): AgentEvent =>
  Object.freeze({
    invocationId,
    pin,
    schemaVersion: 'agent-event/v1',
    sequence,
    timestamp: new Date().toISOString(),
    type,
  });

export class EventSubscriptions {
  private readonly subscriptions = new Set<Subscription>();

  subscribe(filter: AgentEventFilter, listener: AgentEventListener): Unsubscribe {
    const checkedFilter = readFilter(filter);
    if (checkedFilter === undefined || typeof listener !== 'function')
      throw managerError('revo.agent.internal', 'Agent subscription is invalid.');
    const subscription = Object.freeze({ filter: checkedFilter, listener });
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }

  publish(event: AgentEvent): void {
    for (const subscription of this.subscriptions) {
      if (
        (subscription.filter.invocationId === undefined ||
          subscription.filter.invocationId === event.invocationId) &&
        (subscription.filter.agent === undefined ||
          (subscription.filter.agent.id === event.pin.agentId &&
            subscription.filter.agent.version === event.pin.agentVersion)) &&
        (subscription.filter.types === undefined || subscription.filter.types.includes(event.type))
      )
        try {
          subscription.listener(event);
        } catch {
          this.subscriptions.delete(subscription);
        }
    }
  }

  clear(): void {
    this.subscriptions.clear();
  }
}
