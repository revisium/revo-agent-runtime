import {
  compileConsumerSchema,
  validateConsumerSchemaProfile,
  validateManagerOptions,
  type CompiledConsumerSchema,
  type ValidatedDefinition,
} from '../../runtime/definition/index.js';
import { AgentManagerError } from '../../runtime/errors/index.js';
import {
  captureChildEnvironment,
  InvocationInputSnapshot,
  InvocationLifecycle,
  PreparedLaunch,
  registerSecrets,
  StartContextSnapshot,
  type ChildEnvironmentCapture,
  type InvocationExecutionPorts,
  type NormalizedInvocationOutcome,
  type ResultSchemaValidator,
} from '../../runtime/execution/index.js';
import { AGENT_FAULT_MESSAGES } from '../../runtime/policy/index.js';
import { probeExecutable } from '../../runtime/probe/index.js';
import type { ExecutableProbePort } from '../../runtime/probe/index.js';
import { SealedAgentRegistry } from '../../runtime/registry/index.js';
import type {
  AgentDefinitionContract,
  AgentManagerLimits,
  JsonObject,
  JsonValue,
} from '../../runtime/spec/index.js';
import { CompletedInvocations } from './completed-invocations.js';
import { InstalledBindingRegistry } from './installed-bindings.js';
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

const parametersSchemaPath = '/definition/parameters/schema';
const permissionsSchemaPath = '/definition/permissions/schema';
const effectiveParametersPath = '/parameters';
const effectivePermissionsPath = '/permissions';

interface EffectiveInputValidators {
  readonly parameters: CompiledConsumerSchema;
  readonly permissions: CompiledConsumerSchema;
}

type DefinitionInputSchema = AgentDefinitionContract['parameters'];

const overlayTopLevelDefaults = (
  defaults: JsonObject | undefined,
  caller: JsonObject,
): JsonObject => {
  const effective: Record<string, JsonValue> = {};
  Object.setPrototypeOf(effective, null);
  for (const [key, value] of Object.entries(defaults ?? {})) effective[key] = value;
  for (const [key, value] of Object.entries(caller)) effective[key] = value;
  return Object.freeze(effective);
};

const compileEffectiveInputValidator = (
  input: DefinitionInputSchema,
  schemaPath: string,
): CompiledConsumerSchema | undefined => {
  const profile = validateConsumerSchemaProfile(input.schema, schemaPath);
  if (!profile.valid) return undefined;
  try {
    return compileConsumerSchema(profile.schema, schemaPath);
  } catch {
    return undefined;
  }
};

const createEffectiveInputValidators = (
  definitions: readonly ValidatedDefinition[],
): ReadonlyMap<string, EffectiveInputValidators> => {
  const validators = new Map<string, EffectiveInputValidators>();
  for (const target of definitions) {
    const parameters = compileEffectiveInputValidator(
      target.definition.parameters,
      parametersSchemaPath,
    );
    const permissions = compileEffectiveInputValidator(
      target.definition.permissions,
      permissionsSchemaPath,
    );
    if (parameters !== undefined && permissions !== undefined)
      validators.set(target.definitionDigest, Object.freeze({ parameters, permissions }));
  }
  return validators;
};

interface EffectiveInvocationInputs {
  readonly parameters: JsonObject;
  readonly permissions: JsonObject;
}

type CapturedChildEnvironment = Extract<ChildEnvironmentCapture, { status: 'captured' }>;

type PreflightBinding = ReturnType<InstalledBindingRegistry['createBinding']>;

interface ResourceIndependentPreflight {
  readonly target: ValidatedDefinition;
  readonly binding: PreflightBinding;
  readonly effectiveInputs: EffectiveInvocationInputs;
  readonly resultSchemaValidator: ResultSchemaValidator;
  readonly childEnvironment: CapturedChildEnvironment;
  readonly secretValues: readonly string[];
}

type PreflightRejection =
  | Readonly<{ status: 'rejected' }>
  | Readonly<{ status: 'invalid-result-schema' }>;

const validateEffectiveInvocationInputs = (
  validators: EffectiveInputValidators,
  definition: AgentDefinitionContract,
  snapshot: InvocationInputSnapshot,
): EffectiveInvocationInputs | undefined => {
  if (snapshot.parameters === undefined || snapshot.permissions === undefined) return undefined;
  const effectiveParameters = overlayTopLevelDefaults(
    definition.parameters.defaults,
    snapshot.parameters,
  );
  if (validators.parameters.validate(effectiveParameters, effectiveParametersPath) !== undefined)
    return undefined;
  const effectivePermissions = overlayTopLevelDefaults(
    definition.permissions.defaults,
    snapshot.permissions,
  );
  if (validators.permissions.validate(effectivePermissions, effectivePermissionsPath) !== undefined)
    return undefined;
  return Object.freeze({ parameters: effectiveParameters, permissions: effectivePermissions });
};

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

const createNamedHostEnvironmentSnapshot = (
  names: readonly string[],
): Readonly<Record<string, string>> => {
  const snapshot: Record<string, string> = {};
  Object.setPrototypeOf(snapshot, null);
  for (const name of names) {
    const value = process.env[name];
    if (value === undefined) continue;
    Object.defineProperty(snapshot, name, {
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
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
  readonly #configuredSecretValues: readonly string[];
  private readonly active = new Map<string, ActiveInvocation>();
  private readonly pending = new Set<string>();
  constructor(
    private readonly ports: LifecycleManagerPorts,
    private readonly completed: CompletedInvocations,
    private readonly subscriptions: TerminalSubscriptions,
    private readonly registry: SealedAgentRegistry,
    private readonly installedBindings: InstalledBindingRegistry,
    private readonly effectiveInputValidators: ReadonlyMap<string, EffectiveInputValidators>,
    private readonly limits: Readonly<AgentManagerLimits>,
    configuredSecretValues: readonly string[],
  ) {
    this.#configuredSecretValues = configuredSecretValues;
  }

  async start(input: unknown, context?: unknown): Promise<LifecycleStartOutcome> {
    const snapshot = InvocationInputSnapshot.create(input, this.limits);
    const startContext = StartContextSnapshot.create(context);
    if (snapshot === undefined || startContext === undefined)
      return Object.freeze({ status: 'rejected', reason: 'invalid_request' });
    if (!this.reserve(snapshot.invocationId))
      return Object.freeze({ status: 'rejected', reason: 'duplicate_invocation' });
    try {
      const preflightResult = await this.preflight(snapshot, startContext);
      if (preflightResult.status === 'invalid-result-schema')
        return Object.freeze({ status: 'rejected', reason: 'invalid_result_schema' });
      if (preflightResult.status === 'rejected')
        return Object.freeze({ status: 'rejected', reason: 'preflight_failed' });
      const preparedLaunch = preflightResult.preparedLaunch;
      try {
        await this.ports.output.prepare();
      } catch {
        return Object.freeze({ status: 'rejected', reason: 'output_prepare_failed' });
      }

      const completion = createDeferred<NormalizedInvocationOutcome>();
      const lifecycle = new InvocationLifecycle(this.ports, snapshot, preparedLaunch, (outcome) =>
        this.complete(snapshot.invocationId, completion, outcome),
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

  private async preflight(
    snapshot: InvocationInputSnapshot,
    context: StartContextSnapshot,
  ): Promise<
    | Readonly<{ status: 'accepted'; preparedLaunch: PreparedLaunch }>
    | Readonly<{ status: 'rejected' }>
    | Readonly<{ status: 'invalid-result-schema' }>
  > {
    const resourceIndependent = this.prepareResourceIndependentPreflight(snapshot, context);
    if (resourceIndependent.status !== 'accepted') return resourceIndependent;
    const {
      target,
      binding,
      effectiveInputs,
      resultSchemaValidator,
      childEnvironment,
      secretValues,
    } = resourceIndependent;
    const workspace = this.ports.workspace;
    if (
      workspace === undefined ||
      typeof workspace.admit !== 'function' ||
      (await workspace.admit(snapshot.workspace)).status !== 'admitted'
    )
      return Object.freeze({ status: 'rejected' });
    const port = this.ports.executableProbe;
    if (port === undefined) return Object.freeze({ status: 'rejected' });
    const result = await probeExecutable(target, port);
    if (result.status === 'available') {
      if (
        result.agent.id !== target.definition.id ||
        result.agent.version !== target.definition.version ||
        result.definitionDigest !== target.definitionDigest
      )
        return Object.freeze({ status: 'rejected' });
      const preparedLaunch = PreparedLaunch.create({
        pin: {
          agentId: target.definition.id,
          agentVersion: target.definition.version,
          definitionDigest: target.definitionDigest,
        },
        executable: result.executable,
        reportedVersion: result.reportedVersion,
        limits: snapshot.limits,
        effectiveParameters: effectiveInputs.parameters,
        effectivePermissions: effectiveInputs.permissions,
        childEnvironment: childEnvironment.environment,
        childEnvironmentSecretValues: childEnvironment.secretValues,
        secretValues,
        resultSchemaValidator,
        binding: binding.binding,
        bindingToken: binding.bindingToken,
      });
      return preparedLaunch === undefined
        ? Object.freeze({ status: 'rejected' })
        : Object.freeze({ status: 'accepted', preparedLaunch });
    }
    if (result.error.code !== 'revo.agent.probe_platform_unsupported')
      return Object.freeze({ status: 'rejected' });
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

  private prepareResourceIndependentPreflight(
    snapshot: InvocationInputSnapshot,
    context: StartContextSnapshot,
  ): Readonly<{ status: 'accepted' } & ResourceIndependentPreflight> | PreflightRejection {
    if (snapshot.agent === undefined) return Object.freeze({ status: 'rejected' });
    const target = this.registry.getDefinition(snapshot.agent);
    if (target === undefined) return Object.freeze({ status: 'rejected' });
    const binding = this.installedBindings.createBinding(target);
    const effectiveInputValidators = this.effectiveInputValidators.get(target.definitionDigest);
    if (effectiveInputValidators === undefined) return Object.freeze({ status: 'rejected' });
    const effectiveInputs = validateEffectiveInvocationInputs(
      effectiveInputValidators,
      target.definition,
      snapshot,
    );
    if (effectiveInputs === undefined) return Object.freeze({ status: 'rejected' });
    const resultSchemaValidator = createResultSchemaValidator(snapshot);
    if (resultSchemaValidator === undefined)
      return Object.freeze({ status: 'invalid-result-schema' });
    const hostSnapshot = createNamedHostEnvironmentSnapshot(context.environment.inherit);
    const childEnvironment = captureChildEnvironment(context.environment, hostSnapshot);
    if (childEnvironment.status === 'rejected') return Object.freeze({ status: 'rejected' });
    const registeredSecrets = registerSecrets({
      configuredSecrets: this.#configuredSecretValues,
      invocationSecrets: childEnvironment.secretValues,
    });
    if (registeredSecrets.status === 'rejected') return Object.freeze({ status: 'rejected' });
    return Object.freeze({
      status: 'accepted',
      target,
      binding,
      effectiveInputs,
      resultSchemaValidator,
      childEnvironment,
      secretValues: registeredSecrets.secretValues,
    });
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
  start(input: unknown, context?: unknown): Promise<LifecycleStartOutcome>;
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
  const installedBindings = InstalledBindingRegistry.create(validated.definitions);
  const effectiveInputValidators = createEffectiveInputValidators(validated.definitions);
  return Object.freeze(
    new InternalInvocationLifecycleManager(
      ports,
      completed,
      subscriptions,
      registry,
      installedBindings,
      effectiveInputValidators,
      validated.limits,
      validated.redaction.secrets,
    ),
  );
};
