import {
  canonicalizeJsonBytes,
  compileConsumerSchema,
  validateConsumerSchemaProfile,
  validateManagerOptions,
  type CompiledConsumerSchema,
  type ValidatedDefinition,
} from '../../runtime/definition/index.js';
import { AgentManagerError } from '../../runtime/errors/index.js';
import {
  captureChildEnvironment,
  beginOutputClaim,
  beginOutputPreparation,
  createOutputClaimAttempt,
  createOutputPreparationAttempt,
  createPreparedExecutionSecurity,
  createPreparedInvocation,
  InvocationInputSnapshot,
  createIsoTimestamp,
  InvocationLifecycle,
  interpretArgumentTemplate,
  PreparedLaunch,
  prepareInvocationPayloads,
  registerSecrets,
  consumeOutputPreparationMaterial,
  consumeRedactionMaterial,
  revealRegisteredSecrets,
  takePreparedInvocationResourcesPayload,
  StartContextSnapshot,
  type ChildEnvironmentCapture,
  type InvocationExecutionPorts,
  type NormalizedInvocationOutcome,
  type OutputClaimAttempt,
  type OutputClaimGuard,
  type OutputClaimResult,
  type OutputPreparationAttempt,
  type ProcessCleanupAttemptOutcome,
  type OutputResourcePlan,
  type ResultSchemaValidator,
  type TerminalPublicationAuthority,
} from '../../runtime/execution/index.js';
import { AGENT_FAULT_MESSAGES, AGENT_RUNTIME_LIMITS } from '../../runtime/policy/index.js';
import { probeExecutable } from '../../runtime/probe/index.js';
import type { ExecutableProbePort } from '../../runtime/probe/index.js';
import { SealedAgentRegistry } from '../../runtime/registry/index.js';
import type {
  AgentDefinitionContract,
  AgentInvocationFilter,
  AgentInvocationSnapshot,
  AgentInvocationStatus,
  AgentManagerLimits,
  JsonObject,
  JsonValue,
} from '../../runtime/spec/index.js';
import { CompletedInvocations } from './completed-invocations.js';
import { createNativeProcessExecutionPort } from './create-native-process-execution-port.js';
import { InstalledBindingRegistry } from './installed-bindings.js';
import type { RetainedInvocationRecord } from './retained-invocation-record.js';
import { TerminalSubscriptions } from './subscriptions.js';

type RejectionReason =
  | 'invalid_request'
  | 'invalid_result_schema'
  | 'duplicate_invocation'
  | 'output_claim_failed'
  | 'output_claim_uncertain'
  | 'output_prepare_failed'
  | 'output_prepare_uncertain'
  | 'environment_invalid'
  | 'manager_closed'
  | 'preflight_failed';

type LifecycleResultLookup =
  | Readonly<{ state: 'active' }>
  | Readonly<{ state: 'completed'; result: NormalizedInvocationOutcome }>
  | Readonly<{ state: 'unknown' }>;
type LifecycleWaitResult = NormalizedInvocationOutcome | Readonly<{ state: 'unknown' }>;
type CancelOutcome =
  | Readonly<{ state: 'requested' }>
  | Readonly<{ state: 'already_completed'; result: NormalizedInvocationOutcome }>
  | Readonly<{ state: 'unknown' }>;
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
  readonly acceptedAt: string;
  readonly completion: Deferred<NormalizedInvocationOutcome>;
  readonly lifecycle: InvocationLifecycle;
}

type LifecycleManagerPorts = Omit<InvocationExecutionPorts, 'execution'> &
  Readonly<{
    execution?: InvocationExecutionPorts['execution'];
    executableProbe?: ExecutableProbePort;
  }>;

type LifecycleStartOutcome =
  | Readonly<{ status: 'rejected'; reason: RejectionReason }>
  | Readonly<{ status: 'accepted'; handle: LifecycleHandle; lifecycle: InvocationLifecycle }>;

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason: unknown) => void;
}

const resultSchemaPath = '/resultSchema';
const resultValuePath = '/result';

const compareStrings = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const compareInvocationSnapshots = (
  left: AgentInvocationSnapshot,
  right: AgentInvocationSnapshot,
): number => {
  const acceptedAtOrder = compareStrings(left.acceptedAt, right.acceptedAt);
  return acceptedAtOrder === 0
    ? compareStrings(left.invocationId, right.invocationId)
    : acceptedAtOrder;
};

const matchesFilter = (
  snapshot: AgentInvocationSnapshot,
  filter: AgentInvocationFilter | undefined,
): boolean => {
  if (filter === undefined) return true;
  if (filter.invocationId !== undefined && snapshot.invocationId !== filter.invocationId)
    return false;
  if (
    filter.agent !== undefined &&
    (snapshot.pin.agentId !== filter.agent.id || snapshot.pin.agentVersion !== filter.agent.version)
  )
    return false;
  return filter.statuses === undefined || filter.statuses.includes(snapshot.status);
};

const activeSnapshot = (
  invocationId: string,
  active: ActiveInvocation,
): AgentInvocationSnapshot => {
  const lifecycle = active.lifecycle;
  const terminalSettlement = lifecycle.terminalSettlement();
  const status: AgentInvocationStatus =
    lifecycle.currentState() === 'terminal' && terminalSettlement !== undefined
      ? terminalSettlement.status
      : lifecycle.activeStatus();
  const metadata = lifecycle.metadata();
  const startedAt = lifecycle.startedAt();
  const finishedAt = lifecycle.terminalFinishedAt();
  return Object.freeze({
    invocationId,
    pin: lifecycle.pin(),
    status,
    ...(metadata === undefined ? {} : { metadata }),
    acceptedAt: active.acceptedAt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    outputDirectory: lifecycle.outputDirectory(),
  });
};

const retainedSnapshot = (
  invocationId: string,
  record: RetainedInvocationRecord,
): AgentInvocationSnapshot =>
  Object.freeze({
    invocationId,
    pin: record.pin,
    status: record.outcome.status,
    ...(record.metadata === undefined ? {} : { metadata: record.metadata }),
    acceptedAt: record.acceptedAt,
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
    outputDirectory: record.outputDirectory,
  });

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

interface ResourceBoundPreflight {
  readonly interpretedTemplate: Extract<
    ReturnType<typeof interpretArgumentTemplate>,
    { status: 'interpreted' }
  >;
  readonly outputPlan: OutputResourcePlan;
  readonly preparedPayloads: Extract<
    ReturnType<typeof prepareInvocationPayloads>,
    { status: 'prepared' }
  >;
}

type PreflightRejection =
  | Readonly<{ status: 'rejected'; reason?: Extract<RejectionReason, 'environment_invalid'> }>
  | Readonly<{ status: 'invalid-result-schema' }>;

const textEncoder = new TextEncoder();

const utf8Bytes = (value: string): Uint8Array => textEncoder.encode(value);

const totalProspectiveArgvBytes = (executable: string, argumentsOut: readonly string[]): number => {
  let total = utf8Bytes(executable).byteLength;
  for (const argument of argumentsOut) total += utf8Bytes(argument).byteLength;
  return total;
};

const containsByteSubstring = (source: Uint8Array, needle: Uint8Array): boolean => {
  if (needle.byteLength === 0 || needle.byteLength > source.byteLength) return false;
  const lastStart = source.byteLength - needle.byteLength;
  for (let start = 0; start <= lastStart; start += 1) {
    let matched = true;
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (source[start + index] === needle[index]) continue;
      matched = false;
      break;
    }
    if (matched) return true;
  }
  return false;
};

const deterministicInputContainsSecret = (
  secret: Uint8Array,
  payloads: Extract<
    ReturnType<typeof prepareInvocationPayloads>,
    { status: 'prepared' }
  >['payloads'],
): boolean => {
  for (const argument of payloads.arguments) {
    if (containsByteSubstring(utf8Bytes(argument), secret)) return true;
  }
  for (const file of payloads.files) {
    if (containsByteSubstring(file.bytes, secret)) return true;
  }
  return false;
};

const validateProspectiveBounds = (
  request: Readonly<{
    executable: string;
    payloads: Extract<
      ReturnType<typeof prepareInvocationPayloads>,
      { status: 'prepared' }
    >['payloads'];
    secretValues: readonly string[];
  }>,
): PreflightRejection | undefined => {
  if (
    totalProspectiveArgvBytes(request.executable, request.payloads.arguments) >
    AGENT_RUNTIME_LIMITS.argvBytes
  )
    return Object.freeze({ status: 'rejected' });
  for (const secret of request.secretValues) {
    if (deterministicInputContainsSecret(utf8Bytes(secret), request.payloads))
      return Object.freeze({ status: 'rejected', reason: 'environment_invalid' });
  }
  return undefined;
};

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
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  if (resolve === undefined || reject === undefined)
    throw new Error('Unable to create lifecycle result completion.');
  return Object.freeze({ promise, resolve, reject });
};

const managerClosedError = (): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.manager_closed' as const,
      message: AGENT_FAULT_MESSAGES.managerClosed,
      phase: 'manager' as const,
      retryable: false,
    }),
  );

const shutdownFailedError = (
  failures: readonly ShutdownDrainResult[],
  reason: string | undefined,
): AgentManagerError => {
  const first = failures.find((failure) => failure.kind === 'cleanup_failed');
  return new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.shutdown_failed' as const,
      message: AGENT_FAULT_MESSAGES.shutdownFailed,
      phase: 'shutdown' as const,
      retryable: false,
      details: Object.freeze({
        ...(first === undefined ? {} : { invocationId: first.invocationId }),
        failureCount: failures.length,
        ...(reason === undefined ? {} : { reason }),
      }),
    }),
  );
};

const textDecoder = new TextDecoder();
const redactedShutdownReason = (
  reason: string | undefined,
  secretValues: readonly string[],
): string | undefined => {
  if (reason === undefined) return undefined;
  let copied = textDecoder.decode(new TextEncoder().encode(reason).slice(0, 4096));
  for (const secret of secretValues) {
    if (secret.length > 0) copied = copied.split(secret).join('[REDACTED]');
  }
  return copied;
};

type ShutdownDrainResult =
  | Readonly<{ invocationId: string; kind: 'terminal' }>
  | Readonly<{
      invocationId: string;
      kind: 'cleanup_failed';
      outcome: ProcessCleanupAttemptOutcome;
    }>;

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

const createOutputAdmissionRequest = (
  snapshot: InvocationInputSnapshot,
  binding: PreflightBinding,
): OutputResourcePlan | undefined => {
  if (snapshot.outputDirectory === undefined) return undefined;
  return Object.freeze({
    invocationId: snapshot.invocationId,
    outputDirectory: snapshot.outputDirectory,
    needsPromptFile: binding.binding.delivery.prompt === 'file',
    needsResultSchemaFile: binding.binding.delivery.resultSchema === 'file',
  });
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
  #closing = false;
  #shutdownDeferred: Deferred<void> | undefined;
  #firstShutdownReason: string | undefined;
  private readonly executionPort: InvocationExecutionPorts['execution'];
  private readonly active = new Map<string, ActiveInvocation>();
  private readonly pending = new Set<string>();
  // Retained until the future retained-claim reconciliation slice can inspect
  // these guards; dropping them here would make late reconciliation impossible.
  private readonly quarantinedInvocationIds = new Map<string, OutputClaimGuard>();
  private readonly quarantinedOutputDirectories = new Set<string>();
  private readonly quarantinedPreparationInvocationIds = new Set<string>();
  private readonly quarantinedPreparationOutputDirectories = new Set<string>();
  private readonly pendingClaimAttempts = new Map<string, OutputClaimAttempt>();
  private readonly pendingPreparationAttempts = new Map<string, OutputPreparationAttempt>();
  private readonly inFlightStarts = new Map<string, Deferred<void>>();
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
    this.executionPort =
      ports.execution ??
      createNativeProcessExecutionPort(undefined, limits.activeStateOperationTimeoutMs);
  }

  async start(input: unknown, context?: unknown): Promise<LifecycleStartOutcome> {
    const snapshot = InvocationInputSnapshot.create(input, this.limits);
    const startContext = StartContextSnapshot.create(context);
    if (snapshot === undefined || startContext === undefined)
      return Object.freeze({ status: 'rejected', reason: 'invalid_request' });
    if (this.#closing) return Object.freeze({ status: 'rejected', reason: 'manager_closed' });
    if (!this.reserve(snapshot.invocationId))
      return Object.freeze({ status: 'rejected', reason: 'duplicate_invocation' });
    const startCompletion = createDeferred<void>();
    this.inFlightStarts.set(snapshot.invocationId, startCompletion);
    try {
      const preflightResult = await this.preflight(snapshot, startContext);
      if (this.#closing) return Object.freeze({ status: 'rejected', reason: 'preflight_failed' });
      if (preflightResult.status === 'invalid-result-schema')
        return Object.freeze({ status: 'rejected', reason: 'invalid_result_schema' });
      if (preflightResult.status === 'rejected')
        return Object.freeze({
          status: 'rejected',
          reason: preflightResult.reason ?? 'preflight_failed',
        });
      const preparedLaunch = preflightResult.preparedLaunch;
      const plan = preparedLaunch.outputResourcePlan;
      if (this.quarantinedOutputDirectories.has(plan.outputDirectory))
        return Object.freeze({ status: 'rejected', reason: 'output_claim_failed' });
      if (this.quarantinedPreparationOutputDirectories.has(plan.outputDirectory))
        return Object.freeze({ status: 'rejected', reason: 'output_prepare_uncertain' });
      const claim = await this.claimInvocationOutput(plan);
      if (this.#closing) {
        if (claim?.status === 'uncertain') {
          this.quarantinedInvocationIds.set(snapshot.invocationId, claim.guard);
          this.quarantinedOutputDirectories.add(plan.outputDirectory);
          return Object.freeze({ status: 'rejected', reason: 'output_claim_uncertain' });
        }
        return Object.freeze({ status: 'rejected', reason: 'output_claim_failed' });
      }
      if (claim === undefined || claim.status === 'rejected')
        return Object.freeze({ status: 'rejected', reason: 'output_claim_failed' });
      if (claim.status === 'uncertain') {
        this.quarantinedInvocationIds.set(snapshot.invocationId, claim.guard);
        this.quarantinedOutputDirectories.add(plan.outputDirectory);
        return Object.freeze({ status: 'rejected', reason: 'output_claim_uncertain' });
      }
      const preparation = this.createOutputPreparation(
        snapshot,
        preparedLaunch,
        plan,
        claim.session,
      );
      if (preparation === undefined)
        return Object.freeze({ status: 'rejected', reason: 'output_prepare_failed' });
      this.pendingPreparationAttempts.set(snapshot.invocationId, preparation.attempt);
      const preparationResult = await this.consumeAndBeginOutputPreparation(preparation);
      this.pendingPreparationAttempts.delete(snapshot.invocationId);
      if (preparationResult.status === 'rejected') {
        this.quarantinedPreparationInvocationIds.add(snapshot.invocationId);
        this.quarantinedPreparationOutputDirectories.add(plan.outputDirectory);
        return Object.freeze({ status: 'rejected', reason: 'output_prepare_failed' });
      }
      if (preparationResult.status === 'uncertain') {
        this.quarantinedPreparationInvocationIds.add(snapshot.invocationId);
        this.quarantinedPreparationOutputDirectories.add(plan.outputDirectory);
        return Object.freeze({ status: 'rejected', reason: 'output_prepare_uncertain' });
      }
      if (preparationResult.status !== 'prepared')
        return Object.freeze({ status: 'rejected', reason: 'output_prepare_failed' });
      if (this.#closing) {
        this.quarantinedPreparationInvocationIds.add(snapshot.invocationId);
        this.quarantinedPreparationOutputDirectories.add(plan.outputDirectory);
        return Object.freeze({ status: 'rejected', reason: 'output_prepare_uncertain' });
      }
      const resources = preparationResult.resources;
      const authority = preparationResult.authority;
      const acceptedAt = createIsoTimestamp();

      const completion = createDeferred<NormalizedInvocationOutcome>();
      const lifecyclePorts: InvocationExecutionPorts = Object.freeze({
        ...this.ports,
        execution: Object.freeze({
          start: (
            startSnapshot: Parameters<InvocationExecutionPorts['execution']['start']>[0],
            startPreparedLaunch: Parameters<InvocationExecutionPorts['execution']['start']>[1],
          ) => this.executionPort.start(startSnapshot, startPreparedLaunch, resources),
        }),
      });
      let lifecycle: InvocationLifecycle;
      lifecycle = new InvocationLifecycle(
        lifecyclePorts,
        snapshot,
        preparedLaunch,
        authority,
        acceptedAt,
        (outcome) => this.complete(snapshot.invocationId, completion, lifecycle, outcome),
      );
      this.active.set(snapshot.invocationId, Object.freeze({ acceptedAt, completion, lifecycle }));
      this.pending.delete(snapshot.invocationId);
      const handle = createHandle(snapshot.invocationId, completion);
      lifecycle.begin();
      return Object.freeze({ status: 'accepted', handle, lifecycle });
    } finally {
      this.pendingPreparationAttempts.delete(snapshot.invocationId);
      this.pending.delete(snapshot.invocationId);
      this.inFlightStarts.delete(snapshot.invocationId);
      startCompletion.resolve(undefined);
    }
  }

  getResult(invocationId: string): LifecycleResultLookup {
    if (this.active.has(invocationId)) return Object.freeze({ state: 'active' });

    const record = this.completed.get(invocationId);
    return record === undefined
      ? Object.freeze({ state: 'unknown' })
      : Object.freeze({ state: 'completed', result: record.outcome });
  }

  waitForResult(invocationId: string): Promise<LifecycleWaitResult> {
    const active = this.active.get(invocationId);
    if (active !== undefined) return active.completion.promise;

    const record = this.completed.get(invocationId);
    return Promise.resolve(record?.outcome ?? Object.freeze({ state: 'unknown' } as const));
  }

  cancel(invocationId: string): Promise<CancelOutcome> {
    const active = this.active.get(invocationId);
    if (active !== undefined) {
      const outcome = active.lifecycle.requestCancellation();
      if (outcome.status === 'committed') {
        void outcome.completion.catch(() => undefined);
        return Promise.resolve(Object.freeze({ state: 'requested' as const }));
      }
      return active.completion.promise.then((result) =>
        Object.freeze({ state: 'already_completed' as const, result }),
      );
    }
    const record = this.completed.get(invocationId);
    if (record !== undefined)
      return Promise.resolve(
        Object.freeze({ state: 'already_completed' as const, result: record.outcome }),
      );
    return Promise.resolve(Object.freeze({ state: 'unknown' as const }));
  }

  getInvocation(invocationId: string): AgentInvocationSnapshot | undefined {
    const active = this.active.get(invocationId);
    if (active !== undefined) return activeSnapshot(invocationId, active);
    const record = this.completed.get(invocationId);
    return record === undefined ? undefined : retainedSnapshot(invocationId, record);
  }

  listInvocations(filter?: AgentInvocationFilter): readonly AgentInvocationSnapshot[] {
    const snapshots = [
      ...[...this.active.entries()].map(([invocationId, active]) =>
        activeSnapshot(invocationId, active),
      ),
      ...this.completed
        .entries()
        .map(([invocationId, record]) => retainedSnapshot(invocationId, record)),
    ];
    return Object.freeze(
      snapshots
        .filter((snapshot) => matchesFilter(snapshot, filter))
        .toSorted(compareInvocationSnapshots),
    );
  }

  subscribe(filter: unknown, listener: TerminalEventListener): TerminalSubscriptionAdmission {
    if (this.#closing) throw managerClosedError();
    return this.subscriptions.subscribe(filter, listener);
  }

  shutdown(reason?: string): Promise<void> {
    if (this.#shutdownDeferred !== undefined) return this.#shutdownDeferred.promise;
    this.#closing = true;
    this.#firstShutdownReason = redactedShutdownReason(reason, this.#configuredSecretValues);
    this.#shutdownDeferred = createDeferred<void>();
    void this.performShutdown().then(this.#shutdownDeferred.resolve, this.#shutdownDeferred.reject);
    return this.#shutdownDeferred.promise;
  }

  private async performShutdown(): Promise<void> {
    const activeDrains = [...this.active.entries()].map(([invocationId, active]) =>
      this.drainActiveInvocation(invocationId, active),
    );
    const claimDrains = [...this.pendingClaimAttempts.values()].map((attempt) => {
      attempt.requestCancellation();
      return attempt.quiescence.catch(() => undefined);
    });
    const preparationDrains = [...this.pendingPreparationAttempts.values()].map((attempt) => {
      attempt.requestCancellation();
      return attempt.quiescence.catch(() => undefined);
    });
    const startDrains = [...this.inFlightStarts.values()].map((start) => start.promise);

    await Promise.all([...claimDrains, ...preparationDrains]);
    await Promise.all(startDrains);
    const results = await Promise.all(activeDrains);
    const failures = results.filter((result) => result.kind === 'cleanup_failed');
    if (failures.length > 0) throw shutdownFailedError(failures, this.#firstShutdownReason);
    this.subscriptions.clear();
  }

  private async drainActiveInvocation(
    invocationId: string,
    active: ActiveInvocation,
  ): Promise<ShutdownDrainResult> {
    active.lifecycle.requestCancellation();
    const outcome = await active.lifecycle.cleanupSettlement;
    if (outcome !== 'confirmed' && outcome !== 'not_dispatched')
      return Object.freeze({ invocationId, kind: 'cleanup_failed' as const, outcome });
    await active.completion.promise.catch(() => undefined);
    return Object.freeze({ invocationId, kind: 'terminal' as const });
  }

  private complete(
    invocationId: string,
    completion: Deferred<NormalizedInvocationOutcome>,
    lifecycle: InvocationLifecycle,
    outcome: NormalizedInvocationOutcome,
  ): void {
    const active = this.active.get(invocationId);
    if (active === undefined) throw new Error('Completed invocation is not active.');
    const acceptedAt = active.acceptedAt;
    this.completed.commit(
      invocationId,
      Object.freeze({
        outcome,
        pin: lifecycle.pin(),
        acceptedAt,
        startedAt: lifecycle.startedAt(),
        finishedAt: lifecycle.terminalFinishedAt(),
        metadata: lifecycle.metadata(),
        outputDirectory: lifecycle.outputDirectory(),
      }),
    );
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

  private async prepareResourceBoundPreflight(
    snapshot: InvocationInputSnapshot,
    request: Readonly<{
      binding: PreflightBinding;
      effectiveInputs: EffectiveInvocationInputs;
      target: ValidatedDefinition;
    }>,
  ): Promise<
    Readonly<{ status: 'accepted' } & ResourceBoundPreflight> | Readonly<{ status: 'rejected' }>
  > {
    const workspace = this.ports.workspace;
    if (workspace === undefined || typeof workspace.admit !== 'function')
      return Object.freeze({ status: 'rejected' });
    const workspaceAdmission = await workspace.admit(snapshot.workspace);
    if (this.#closing) return Object.freeze({ status: 'rejected' });
    if (workspaceAdmission.status !== 'admitted') return Object.freeze({ status: 'rejected' });
    const outputAdmissionRequest = createOutputAdmissionRequest(snapshot, request.binding);
    if (outputAdmissionRequest === undefined) return Object.freeze({ status: 'rejected' });
    const outputAdmission = await this.ports.output.admit(outputAdmissionRequest);
    if (this.#closing) return Object.freeze({ status: 'rejected' });
    if (outputAdmission.status !== 'admitted') return Object.freeze({ status: 'rejected' });
    const interpretedTemplate = interpretArgumentTemplate({
      template: request.target.definition.launch.args,
      effectiveParameters: request.effectiveInputs.parameters,
      effectivePermissions: request.effectiveInputs.permissions,
      outputResourcePlan: outputAdmission.plan,
      permissionStrategy: request.binding.permissionStrategy,
      workspace: workspaceAdmission,
    });
    if (interpretedTemplate.status === 'rejected') return Object.freeze({ status: 'rejected' });
    if (snapshot.prompt === undefined) return Object.freeze({ status: 'rejected' });
    const preparedPayloads = prepareInvocationPayloads({
      binding: request.binding.binding,
      interpretedArgumentTemplate: interpretedTemplate.template,
      outputResourcePlan: outputAdmission.plan,
      prompt: snapshot.prompt,
      resultSchemaBytes: canonicalizeJsonBytes(snapshot.resultSchema),
    });
    if (preparedPayloads.status === 'rejected') return Object.freeze({ status: 'rejected' });
    return Object.freeze({
      status: 'accepted',
      interpretedTemplate,
      outputPlan: outputAdmission.plan,
      preparedPayloads,
    });
  }

  private async preflight(
    snapshot: InvocationInputSnapshot,
    context: StartContextSnapshot,
  ): Promise<
    Readonly<{ status: 'accepted'; preparedLaunch: PreparedLaunch }> | PreflightRejection
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
    const resourceBound = await this.prepareResourceBoundPreflight(snapshot, {
      binding,
      effectiveInputs,
      target,
    });
    if (resourceBound.status === 'rejected') return Object.freeze({ status: 'rejected' });
    const port = this.ports.executableProbe;
    if (port === undefined) return Object.freeze({ status: 'rejected' });
    const result = await probeExecutable(target, port);
    if (this.#closing) return Object.freeze({ status: 'rejected' });
    if (result.status === 'available') {
      if (
        result.agent.id !== target.definition.id ||
        result.agent.version !== target.definition.version ||
        result.definitionDigest !== target.definitionDigest
      )
        return Object.freeze({ status: 'rejected' });
      const boundsRejection = validateProspectiveBounds({
        executable: result.executable,
        payloads: resourceBound.preparedPayloads.payloads,
        secretValues,
      });
      if (boundsRejection !== undefined) return boundsRejection;
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
        outputResourcePlan: resourceBound.outputPlan,
        interpretedArgumentTemplate: resourceBound.interpretedTemplate.template,
        preparedPayloads: resourceBound.preparedPayloads.payloads,
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
    const secretValues = revealRegisteredSecrets(registeredSecrets.registeredSecrets);
    if (secretValues === undefined) return Object.freeze({ status: 'rejected' });
    return Object.freeze({
      status: 'accepted',
      target,
      binding,
      effectiveInputs,
      resultSchemaValidator,
      childEnvironment,
      secretValues,
    });
  }

  private reserve(invocationId: string): boolean {
    if (
      this.pending.has(invocationId) ||
      this.active.has(invocationId) ||
      this.completed.has(invocationId) ||
      this.quarantinedInvocationIds.has(invocationId) ||
      this.quarantinedPreparationInvocationIds.has(invocationId)
    )
      return false;
    this.pending.add(invocationId);
    return true;
  }

  private createOutputPreparation(
    snapshot: InvocationInputSnapshot,
    preparedLaunch: PreparedLaunch,
    plan: OutputResourcePlan,
    session: Extract<OutputClaimResult, { status: 'claimed' }>['session'],
  ):
    | Readonly<{
        attempt: OutputPreparationAttempt;
        preparedInvocation: NonNullable<ReturnType<typeof createPreparedInvocation>>;
        preparedSecurity: NonNullable<ReturnType<typeof createPreparedExecutionSecurity>>;
      }>
    | undefined {
    const registeredSecrets = registerSecrets({
      configuredSecrets: this.#configuredSecretValues,
      invocationSecrets: preparedLaunch.secretValues,
    });
    if (registeredSecrets.status !== 'registered') return undefined;
    const preparedInvocation = createPreparedInvocation({
      pin: preparedLaunch.pin,
      workspaceDirectory: snapshot.workspace,
      reportedVersion: preparedLaunch.reportedVersion,
      binding: preparedLaunch.binding,
      outputResourcePlan: plan,
      preparedPayloads: preparedLaunch.preparedPayloads,
    });
    if (preparedInvocation === undefined) return undefined;
    const preparedSecurity = createPreparedExecutionSecurity({
      invocationId: snapshot.invocationId,
      childEnvironment: preparedLaunch.childEnvironment,
      registeredSecrets: registeredSecrets.registeredSecrets,
    });
    if (preparedSecurity === undefined) return undefined;
    const attempt = createOutputPreparationAttempt({
      session,
      clock: this.ports.clock,
      port: this.ports.outputPreparation,
    });
    return attempt === undefined
      ? undefined
      : Object.freeze({ attempt, preparedInvocation, preparedSecurity });
  }

  private async consumeAndBeginOutputPreparation(
    preparation: Readonly<{
      attempt: OutputPreparationAttempt;
      preparedInvocation: NonNullable<ReturnType<typeof createPreparedInvocation>>;
      preparedSecurity: NonNullable<ReturnType<typeof createPreparedExecutionSecurity>>;
    }>,
  ): Promise<
    | Readonly<{
        status: 'prepared';
        resources: NonNullable<ReturnType<typeof takePreparedInvocationResourcesPayload>>;
        authority: TerminalPublicationAuthority;
      }>
    | Readonly<{ status: 'rejected' | 'uncertain' }>
  > {
    const material = consumeOutputPreparationMaterial(
      preparation.preparedInvocation,
      preparation.attempt,
    );
    const redaction = consumeRedactionMaterial(preparation.preparedSecurity, preparation.attempt);
    if (material === undefined || redaction === undefined)
      return Object.freeze({ status: 'rejected' as const });
    beginOutputPreparation(preparation.attempt, material, redaction);
    const result = await preparation.attempt.settlement;
    if (result.status === 'prepared') {
      const resources = takePreparedInvocationResourcesPayload(result.resources);
      if (resources === undefined) return Object.freeze({ status: 'rejected' as const });
      return Object.freeze({ status: 'prepared' as const, resources, authority: result.authority });
    }
    return Object.freeze({ status: result.status });
  }

  private async claimInvocationOutput(
    plan: OutputResourcePlan,
  ): Promise<OutputClaimResult | undefined> {
    const port = this.ports.outputClaim;
    if (port === undefined || typeof port.createExclusiveOutputDirectory !== 'function')
      return undefined;
    const attempt = createOutputClaimAttempt({
      invocationId: plan.invocationId,
      outputDirectory: plan.outputDirectory,
      clock: this.ports.clock,
      port,
    });
    this.pendingClaimAttempts.set(plan.invocationId, attempt);
    try {
      beginOutputClaim(attempt);
      return await attempt.settlement;
    } finally {
      this.pendingClaimAttempts.delete(plan.invocationId);
    }
  }
}

export const createInvocationLifecycleManager = (
  options: unknown,
  ports: LifecycleManagerPorts,
): Readonly<{
  cancel(invocationId: string): Promise<CancelOutcome>;
  getInvocation(invocationId: string): AgentInvocationSnapshot | undefined;
  getResult(invocationId: string): LifecycleResultLookup;
  listInvocations(filter?: AgentInvocationFilter): readonly AgentInvocationSnapshot[];
  start(input: unknown, context?: unknown): Promise<LifecycleStartOutcome>;
  subscribe(filter: unknown, listener: TerminalEventListener): TerminalSubscriptionAdmission;
  shutdown(reason?: string): Promise<void>;
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
