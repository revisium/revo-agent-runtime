const maximumInvocationIdBytes = 256;
const encoder = new TextEncoder();

type TerminalInvocationEvent = import('../../runtime/spec/index.js').AgentEvent;

type TerminalEventListener = (event: TerminalInvocationEvent) => void;
type TerminalSubscriptionAdmission = import('../../runtime/spec/index.js').Unsubscribe;

const invalidSubscription = (message: string): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.invocation_invalid' as const,
      message: AGENT_FAULT_MESSAGES.invocationInvalid,
      phase: 'manager' as const,
      retryable: false,
      details: Object.freeze({ message }),
    }),
  );

interface Subscription {
  readonly invocationId: string | undefined;
  readonly agent: Readonly<{ id: string; version: string }> | undefined;
  readonly types: readonly TerminalInvocationEvent['type'][] | undefined;
  readonly listener: TerminalEventListener;
}

const isFilterRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const validIdentity = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  encoder.encode(value).byteLength <= maximumInvocationIdBytes;

const isTerminalEventType = (value: unknown): value is TerminalInvocationEvent['type'] =>
  value === 'invocation.accepted' ||
  value === 'invocation.started' ||
  value === 'invocation.cancelling' ||
  value === 'invocation.finished';

const copyInvocationIdField = (filter: Record<PropertyKey, unknown>): string | undefined => {
  if (!Object.hasOwn(filter, 'invocationId')) return undefined;
  const invocationId = filter.invocationId;
  if (!validIdentity(invocationId))
    throw invalidSubscription('Terminal event filter invocationId is invalid.');
  return invocationId;
};

const copyAgentField = (
  filter: Record<PropertyKey, unknown>,
): Readonly<{ id: string; version: string }> | undefined => {
  if (!Object.hasOwn(filter, 'agent')) return undefined;
  const agent = filter.agent;
  if (
    !isFilterRecord(agent) ||
    Reflect.ownKeys(agent).length !== 2 ||
    !Object.hasOwn(agent, 'id') ||
    !Object.hasOwn(agent, 'version') ||
    !validIdentity(agent.id) ||
    !validIdentity(agent.version)
  )
    throw invalidSubscription('Terminal event filter agent is invalid.');
  return Object.freeze({ id: agent.id, version: agent.version });
};

const copyTypesField = (
  filter: Record<PropertyKey, unknown>,
): readonly TerminalInvocationEvent['type'][] | undefined => {
  if (!Object.hasOwn(filter, 'types')) return undefined;
  const rawTypes = filter.types;
  if (!Array.isArray(rawTypes) || rawTypes.length > 4)
    throw invalidSubscription('Terminal event filter types are invalid.');
  const copiedTypes: TerminalInvocationEvent['type'][] = [];
  for (const type of rawTypes) {
    if (!isTerminalEventType(type))
      throw invalidSubscription('Terminal event filter types are invalid.');
    copiedTypes.push(type);
  }
  return Object.freeze(copiedTypes);
};

const copyFilter = (
  filter: unknown,
): Readonly<{
  invocationId?: string;
  agent?: Readonly<{ id: string; version: string }>;
  types?: readonly TerminalInvocationEvent['type'][];
}> => {
  if (!isFilterRecord(filter))
    throw invalidSubscription('Terminal event filter must be an object.');

  const keys = Reflect.ownKeys(filter);
  if (keys.some((key) => key !== 'invocationId' && key !== 'agent' && key !== 'types'))
    throw invalidSubscription('Terminal event filter contains an unsupported field.');
  const copiedInvocationId = copyInvocationIdField(filter);
  const agent = copyAgentField(filter);
  const types = copyTypesField(filter);
  return Object.freeze({
    ...(copiedInvocationId === undefined ? {} : { invocationId: copiedInvocationId }),
    ...(agent === undefined ? {} : { agent }),
    ...(types === undefined ? {} : { types }),
  });
};

const isTerminalEventListener = (value: unknown): value is TerminalEventListener =>
  typeof value === 'function';

export class TerminalSubscriptions {
  private readonly subscriptions = new Set<Subscription>();
  private isolatedFailures = 0;

  subscribe(filter: unknown, listener: TerminalEventListener): TerminalSubscriptionAdmission {
    if (!isTerminalEventListener(listener))
      throw invalidSubscription('Terminal event listener must be a function.');

    const copied = copyFilter(filter);
    const subscription: Subscription = Object.freeze({
      invocationId: copied.invocationId,
      agent: copied.agent,
      types: copied.types,
      listener,
    });
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }

  deliver(event: TerminalInvocationEvent): void {
    const matching = [...this.subscriptions].filter(
      (subscription) =>
        (subscription.invocationId === undefined ||
          subscription.invocationId === event.invocationId) &&
        (subscription.agent === undefined || pinMatchesAgentRef(event.pin, subscription.agent)) &&
        (subscription.types === undefined || subscription.types.includes(event.type)),
    );
    for (const subscription of matching) {
      if (!this.subscriptions.has(subscription)) continue;
      try {
        subscription.listener(event);
      } catch {
        this.isolatedFailures += 1;
      }
    }
  }

  clear(): void {
    this.subscriptions.clear();
  }

  isolatedFailureCount(): number {
    return this.isolatedFailures;
  }
}
import { AgentManagerError } from '../../runtime/errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../runtime/policy/index.js';
import { pinMatchesAgentRef } from './pin-matches-agent-ref.js';
