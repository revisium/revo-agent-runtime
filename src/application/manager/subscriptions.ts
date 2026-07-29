const maximumInvocationIdBytes = 256;
const encoder = new TextEncoder();

type TerminalInvocationEvent = Readonly<{
  type: 'invocation.finished';
  invocationId: string;
}>;

type TerminalEventListener = (event: TerminalInvocationEvent) => void;
type TerminalSubscriptionAdmission =
  | Readonly<{ state: 'subscribed'; dispose: () => void }>
  | Readonly<{ state: 'rejected'; reason: 'capacity' }>;

interface Subscription {
  readonly invocationId: string | undefined;
  readonly listener: TerminalEventListener;
}

const isFilterRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const copyInvocationIdFilter = (filter: unknown): string | undefined => {
  if (!isFilterRecord(filter)) throw new TypeError('Terminal event filter must be an object.');

  const keys = Reflect.ownKeys(filter);
  if (keys.some((key) => key !== 'invocationId'))
    throw new TypeError('Terminal event filter contains an unsupported field.');
  if (!Object.hasOwn(filter, 'invocationId')) return undefined;

  const invocationId = filter.invocationId;
  if (
    typeof invocationId !== 'string' ||
    invocationId.length === 0 ||
    encoder.encode(invocationId).byteLength > maximumInvocationIdBytes
  )
    throw new TypeError('Terminal event filter invocationId is invalid.');

  return invocationId;
};

const isTerminalEventListener = (value: unknown): value is TerminalEventListener =>
  typeof value === 'function';

export class TerminalSubscriptions {
  private readonly subscriptions = new Set<Subscription>();

  constructor(private readonly capacity: number) {}

  subscribe(filter: unknown, listener: TerminalEventListener): TerminalSubscriptionAdmission {
    if (!isTerminalEventListener(listener))
      throw new TypeError('Terminal event listener must be a function.');

    const invocationId = copyInvocationIdFilter(filter);
    if (this.subscriptions.size === this.capacity)
      return Object.freeze({ state: 'rejected', reason: 'capacity' });

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
        this.subscriptions.delete(subscription);
      }
    }
  }
}
