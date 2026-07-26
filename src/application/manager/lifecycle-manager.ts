import {
  compileConsumerSchema,
  validateConsumerSchemaProfile,
  validateManagerOptions,
} from '../../runtime/definition/index.js';
import {
  InvocationInputSnapshot,
  InvocationLifecycle,
  type InvocationExecutionPorts,
  type NormalizedInvocationOutcome,
  type ResultSchemaValidator,
} from '../../runtime/execution/index.js';
import type { JsonObject } from '../../runtime/spec/index.js';
import { CompletedInvocations } from './completed-invocations.js';
import { TerminalSubscriptions } from './subscriptions.js';

type RejectionReason =
  | 'invalid_request'
  | 'invalid_result_schema'
  | 'duplicate_invocation'
  | 'output_prepare_failed';

type LifecycleResultLookup =
  | Readonly<{ state: 'active' }>
  | Readonly<{ state: 'completed'; result: NormalizedInvocationOutcome }>
  | Readonly<{ state: 'unknown' }>;
type LifecycleWaitResult = NormalizedInvocationOutcome | Readonly<{ state: 'unknown' }>;
type TerminalInvocationEvent = Readonly<{
  type: 'invocation.finished';
  invocationId: string;
  result: NormalizedInvocationOutcome;
}>;
type TerminalEventListener = (event: TerminalInvocationEvent) => void;
type TerminalSubscriptionAdmission = ReturnType<TerminalSubscriptions['subscribe']>;

interface LifecycleHandle {
  readonly invocationId: string;
  result(): Promise<NormalizedInvocationOutcome>;
}

interface ActiveInvocation {
  readonly completion: Deferred<NormalizedInvocationOutcome>;
  readonly lifecycle: InvocationLifecycle;
}

type LifecycleStartOutcome =
  | Readonly<{ status: 'rejected'; reason: RejectionReason }>
  | Readonly<{ status: 'accepted'; handle: LifecycleHandle; lifecycle: InvocationLifecycle }>;

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

const resultSchemaPath = '/resultSchema';
const resultValuePath = '/result';

const createDeferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (resolve === undefined) throw new Error('Unable to create lifecycle result completion.');
  return Object.freeze({ promise, resolve });
};

const createResultSchemaValidator = (
  snapshot: InvocationInputSnapshot,
): ResultSchemaValidator | undefined => {
  const profile = validateConsumerSchemaProfile(snapshot.resultSchema, resultSchemaPath);
  if (!profile.valid) return undefined;
  try {
    const compiled = compileConsumerSchema(profile.schema, resultSchemaPath);
    return Object.freeze({
      validate: (value: JsonObject) => compiled.validate(value, resultValuePath),
    });
  } catch {
    return undefined;
  }
};

const createHandle = (
  invocationId: string,
  completion: Deferred<NormalizedInvocationOutcome>,
): LifecycleHandle =>
  Object.freeze({
    invocationId,
    result: () => completion.promise,
  });

class InternalInvocationLifecycleManager {
  private readonly active = new Map<string, ActiveInvocation>();
  constructor(
    private readonly ports: InvocationExecutionPorts,
    private readonly completed: CompletedInvocations,
    private readonly subscriptions: TerminalSubscriptions,
  ) {}

  async start(input: unknown): Promise<LifecycleStartOutcome> {
    const snapshot = InvocationInputSnapshot.create(input);
    if (snapshot === undefined)
      return Object.freeze({ status: 'rejected', reason: 'invalid_request' });
    const resultSchemaValidator = createResultSchemaValidator(snapshot);
    if (resultSchemaValidator === undefined)
      return Object.freeze({ status: 'rejected', reason: 'invalid_result_schema' });
    try {
      await this.ports.output.prepare();
    } catch {
      return Object.freeze({ status: 'rejected', reason: 'output_prepare_failed' });
    }
    if (this.active.has(snapshot.invocationId) || this.completed.has(snapshot.invocationId))
      return Object.freeze({ status: 'rejected', reason: 'duplicate_invocation' });

    const completion = createDeferred<NormalizedInvocationOutcome>();
    const lifecycle = new InvocationLifecycle(
      this.ports,
      snapshot,
      (outcome) => this.complete(snapshot.invocationId, completion, outcome),
      resultSchemaValidator,
    );
    this.active.set(snapshot.invocationId, Object.freeze({ completion, lifecycle }));
    const handle = createHandle(snapshot.invocationId, completion);
    lifecycle.begin();
    return Object.freeze({ status: 'accepted', handle, lifecycle });
  }

  getResult(invocationId: string): LifecycleResultLookup {
    if (this.active.has(invocationId)) return Object.freeze({ state: 'active' });

    const result = this.completed.get(invocationId);
    return result === undefined
      ? Object.freeze({ state: 'unknown' })
      : Object.freeze({ state: 'completed', result });
  }

  waitForResult(invocationId: string): Promise<LifecycleWaitResult> {
    const active = this.active.get(invocationId);
    if (active !== undefined) return active.completion.promise;

    const result = this.completed.get(invocationId);
    return Promise.resolve(result ?? Object.freeze({ state: 'unknown' } as const));
  }

  subscribe(filter: unknown, listener: TerminalEventListener): TerminalSubscriptionAdmission {
    return this.subscriptions.subscribe(filter, listener);
  }

  private complete(
    invocationId: string,
    completion: Deferred<NormalizedInvocationOutcome>,
    outcome: NormalizedInvocationOutcome,
  ): void {
    this.completed.commit(invocationId, outcome);
    this.active.delete(invocationId);
    const event: TerminalInvocationEvent = Object.freeze({
      type: 'invocation.finished',
      invocationId,
      result: outcome,
    });
    try {
      this.subscriptions.deliver(event);
    } finally {
      completion.resolve(outcome);
    }
  }
}

export const createInvocationLifecycleManager = (
  options: unknown,
  ports: InvocationExecutionPorts,
): Readonly<{
  getResult(invocationId: string): LifecycleResultLookup;
  start(input: unknown): Promise<LifecycleStartOutcome>;
  subscribe(filter: unknown, listener: TerminalEventListener): TerminalSubscriptionAdmission;
  waitForResult(invocationId: string): Promise<LifecycleWaitResult>;
}> => {
  const validated = validateManagerOptions(options);
  const capacity = validated.limits.maxCompletedInvocations;
  if (capacity === undefined)
    throw new Error('Validated completed invocation capacity is required.');
  const completed = new CompletedInvocations(capacity);
  const subscriptions = new TerminalSubscriptions(capacity);
  return Object.freeze(new InternalInvocationLifecycleManager(ports, completed, subscriptions));
};
