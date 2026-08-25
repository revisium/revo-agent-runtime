const maximumInvocationIdBytes = 256;
const encoder = new TextEncoder();

type TerminalInvocationEvent = Readonly<{
  type: 'invocation.finished';
  invocationId: string;
}>;

type TerminalEventListener = (event: TerminalInvocationEvent) => void;
type TerminalSubscriptionAdmission = Readonly<{ state: 'subscribed'; dispose: () => void }>;

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
  readonly listener: TerminalEventListener;
}

const isFilterRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const copyInvocationIdFilter = (filter: unknown): string | undefined => {
  if (!isFilterRecord(filter))
    throw invalidSubscription('Terminal event filter must be an object.');

  const keys = Reflect.ownKeys(filter);
  if (keys.some((key) => key !== 'invocationId'))
    throw invalidSubscription('Terminal event filter contains an unsupported field.');
  if (!Object.hasOwn(filter, 'invocationId')) return undefined;

  const invocationId = filter.invocationId;
  if (
    typeof invocationId !== 'string' ||
    invocationId.length === 0 ||
    encoder.encode(invocationId).byteLength > maximumInvocationIdBytes
  )
    throw invalidSubscription('Terminal event filter invocationId is invalid.');

  return invocationId;
};

const isTerminalEventListener = (value: unknown): value is TerminalEventListener =>
  typeof value === 'function';

export class TerminalSubscriptions {
  private readonly subscriptions = new Set<Subscription>();
  private isolatedFailures = 0;

  subscribe(filter: unknown, listener: TerminalEventListener): TerminalSubscriptionAdmission {
    if (!isTerminalEventListener(listener))
      throw invalidSubscription('Terminal event listener must be a function.');

    const invocationId = copyInvocationIdFilter(filter);
    const subscription: Subscription = Object.freeze({ invocationId, listener });
    this.subscriptions.add(subscription);
    return Object.freeze({
      state: 'subscribed',
      dispose: () => {
        this.subscriptions.delete(subscription);
      },
    });
  }

  deliver(event: TerminalInvocationEvent): void {
    const matching = [...this.subscriptions].filter(
      (subscription) =>
        subscription.invocationId === undefined || subscription.invocationId === event.invocationId,
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
