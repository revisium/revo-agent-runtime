import {
  compileConsumerSchema,
  validateConsumerSchemaProfile,
  validateManagerOptions,
} from '../../runtime/definition/index.js';
import { AgentManagerError } from '../../runtime/errors/index.js';
import {
  InvocationInputSnapshot,
  InvocationLifecycle,
  type InvocationExecutionPorts,
  type NormalizedInvocationOutcome,
  type ResultSchemaValidator,
} from '../../runtime/execution/index.js';
import { AGENT_FAULT_MESSAGES } from '../../runtime/policy/index.js';
import { probeExecutable } from '../../runtime/probe/index.js';
import type { ExecutableProbePort } from '../../runtime/probe/index.js';
import { SealedAgentRegistry } from '../../runtime/registry/index.js';
import type { JsonObject } from '../../runtime/spec/index.js';
import { CompletedInvocations } from './completed-invocations.js';
import { TerminalSubscriptions } from './subscriptions.js';

type RejectionReason =
  | 'invalid_request'
  | 'invalid_result_schema'
  | 'duplicate_invocation'
  | 'output_prepare_failed'
  | 'preflight_failed';

type LifecycleResultLookup =
  | Readonly<{ state: 'active' }>
  | Readonly<{ state: 'completed'; result: NormalizedInvocationOutcome }>
  | Readonly<{ state: 'unknown' }>;
type LifecycleWaitResult = NormalizedInvocationOutcome | Readonly<{ state: 'unknown' }>;
type TerminalInvocationEvent = Readonly<{
  type: 'invocation.finished';
  invocationId: string;
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

type LifecycleManagerPorts = InvocationExecutionPorts &
  Readonly<{ executableProbe?: ExecutableProbePort }>;

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
  private readonly pending = new Set<string>();
  constructor(
    private readonly ports: LifecycleManagerPorts,
    private readonly completed: CompletedInvocations,
    private readonly subscriptions: TerminalSubscriptions,
    private readonly registry: SealedAgentRegistry,
  ) {}

  async start(input: unknown): Promise<LifecycleStartOutcome> {
    const snapshot = InvocationInputSnapshot.create(input);
    if (snapshot === undefined)
      return Object.freeze({ status: 'rejected', reason: 'invalid_request' });
    const resultSchemaValidator = createResultSchemaValidator(snapshot);
    if (resultSchemaValidator === undefined)
      return Object.freeze({ status: 'rejected', reason: 'invalid_result_schema' });
    if (!this.reserve(snapshot.invocationId))
      return Object.freeze({ status: 'rejected', reason: 'duplicate_invocation' });
    try {
      if (!(await this.preflight(snapshot)))
        return Object.freeze({ status: 'rejected', reason: 'preflight_failed' });
      try {
        await this.ports.output.prepare();
      } catch {
        return Object.freeze({ status: 'rejected', reason: 'output_prepare_failed' });
      }

      const completion = createDeferred<NormalizedInvocationOutcome>();
      const lifecycle = new InvocationLifecycle(
        this.ports,
        snapshot,
        (outcome) => this.complete(snapshot.invocationId, completion, outcome),
        resultSchemaValidator,
      );
      this.active.set(snapshot.invocationId, Object.freeze({ completion, lifecycle }));
      this.pending.delete(snapshot.invocationId);
      const handle = createHandle(snapshot.invocationId, completion);
      lifecycle.begin();
      return Object.freeze({ status: 'accepted', handle, lifecycle });
    } finally {
      this.pending.delete(snapshot.invocationId);
    }
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
    });
    try {
      this.subscriptions.deliver(event);
    } finally {
      completion.resolve(outcome);
    }
  }

  private async preflight(snapshot: InvocationInputSnapshot): Promise<boolean> {
    if (snapshot.workspace !== undefined) {
      const workspace = this.ports.workspace;
      if (
        workspace === undefined ||
        (await workspace.admit(snapshot.workspace)).status !== 'admitted'
      )
        return false;
    }
    if (snapshot.agent === undefined) return this.registry.listAgents().length === 0;
    const target = this.registry.getDefinition(snapshot.agent);
    if (target === undefined) return false;
    const port = this.ports.executableProbe;
    if (port === undefined) return false;
    const result = await probeExecutable(target, port);
    if (result.status === 'available') return true;
    if (result.error.code !== 'revo.agent.probe_platform_unsupported') return false;
    throw new AgentManagerError(
      Object.freeze({
        code: 'revo.agent.platform_unsupported',
        message: AGENT_FAULT_MESSAGES.platformUnsupported,
        phase: 'preflight',
        retryable: false,
        ...(result.error.details === undefined ? {} : { details: result.error.details }),
      }),
    );
  }

  private reserve(invocationId: string): boolean {
    if (
      this.pending.has(invocationId) ||
      this.active.has(invocationId) ||
      this.completed.has(invocationId)
    )
      return false;
    this.pending.add(invocationId);
    return true;
  }
}

export const createInvocationLifecycleManager = (
  options: unknown,
  ports: LifecycleManagerPorts,
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
  const subscriptions = new TerminalSubscriptions();
  const registry = SealedAgentRegistry.create(validated.definitions);
  return Object.freeze(
    new InternalInvocationLifecycleManager(ports, completed, subscriptions, registry),
  );
};
