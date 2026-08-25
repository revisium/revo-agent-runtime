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
  type OutputClaimAttempt,
  type OutputClaimGuard,
  type OutputClaimResult,
  type OutputPreparationAttempt,
  type ProcessCleanupAttemptOutcome,
  type OutputResourcePlan,
  type ResultSchemaValidator,
  type RunningExecution,
  type TerminalPublicationAuthority,
} from '../../runtime/execution/index.js';
import { AGENT_FAULT_MESSAGES, AGENT_RUNTIME_LIMITS } from '../../runtime/policy/index.js';
import { probeExecutable } from '../../runtime/probe/index.js';
import type { ExecutableProbePort } from '../../runtime/probe/index.js';
import { SealedAgentRegistry } from '../../runtime/registry/index.js';
import type {
  ActiveInvocationSnapshot,
  ActiveInvocationStateSink,
  ActiveProcessIdentity,
  AgentDefinitionContract,
  AgentInvocationFilter,
  AgentInvocationResult,
  AgentInvocationSnapshot,
  AgentResultLookup,
  AgentInvocationStatus,
  AgentManagerLimits,
  CancelInvocationResult,
  JsonObject,
  JsonValue,
} from '../../runtime/spec/index.js';
import { ActiveStateLane } from './active-state-lane.js';
import { CompletedInvocations } from './completed-invocations.js';
import { createNamedHostEnvironmentSnapshot } from './create-named-host-environment-snapshot.js';
import { createNativeProcessExecutionPort } from './create-native-process-execution-port.js';
import { inspectBatchRefs } from './inspect-batch-refs.js';
import { InstalledBindingRegistry } from './installed-bindings.js';
import { isRecoverySupportedPlatform } from './is-recovery-supported-platform.js';
import { reconcileRecoveredRows } from './reconcile-recovered-rows.js';
import type { RecoveredRowFailure } from './recovered-row-failure.js';
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
  | 'manager_not_initialized'
  | 'manager_closed'
  | 'process_identity_failed'
  | 'active_state_failed'
  | 'preflight_failed';

type TerminalInvocationEvent = Readonly<{
  type: 'invocation.finished';
  invocationId: string;
}>;
type TerminalEventListener = (event: TerminalInvocationEvent) => void;
type TerminalSubscriptionAdmission = ReturnType<TerminalSubscriptions['subscribe']>;

interface LifecycleHandle {
  readonly invocationId: string;
  result(): Promise<AgentInvocationResult>;
}

interface ActiveInvocation {
  readonly acceptedAt: string;
  readonly completion: Deferred<AgentInvocationResult>;
  readonly lifecycle: InvocationLifecycle;
}

interface RetainedActiveStateGuard {
  readonly activeStateLane: ActiveStateLane;
  readonly killAndReap: () => Promise<ProcessCleanupAttemptOutcome | undefined>;
  readonly outputDirectory: string;
  cleanupConfirmed: boolean;
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
  const terminalResult = lifecycle.terminalResult();
  const status: AgentInvocationStatus =
    lifecycle.currentState() === 'terminal' && terminalResult !== undefined
      ? terminalResult.status
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

const retainedSnapshot = (result: AgentInvocationResult): AgentInvocationSnapshot =>
  Object.freeze({
    invocationId: result.invocationId,
    pin: result.pin,
    status: result.status,
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    acceptedAt: result.acceptedAt,
    ...(result.startedAt === undefined ? {} : { startedAt: result.startedAt }),
    finishedAt: result.finishedAt,
    outputDirectory: result.files.directory,
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
type BatchInspection = ReturnType<typeof inspectBatchRefs>;

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

const managerNotInitializedError = (): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.manager_not_initialized' as const,
      message: AGENT_FAULT_MESSAGES.managerNotInitialized,
      phase: 'initializing' as const,
      retryable: false,
    }),
  );

const invocationUnknownError = (): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.invocation_unknown' as const,
      message: AGENT_FAULT_MESSAGES.invocationUnknown,
      phase: 'manager' as const,
      retryable: false,
    }),
  );

const recoveryInvalidError = (): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.recovery_invalid' as const,
      message: AGENT_FAULT_MESSAGES.recoveryInvalid,
      phase: 'initializing' as const,
      retryable: false,
    }),
  );

const recoveryFailedError = (failures: readonly RecoveredRowFailure[]): AgentManagerError => {
  const boundedFailures: RecoveredRowFailure[] = [];
  for (const failure of failures) {
    const copied = Object.freeze({ ...failure });
    const candidate = [...boundedFailures, copied];
    const candidateTruncated = candidate.length < failures.length;
    const candidateDetails = JSON.stringify({ failures: candidate, truncated: candidateTruncated });
    if (utf8Bytes(candidateDetails).byteLength > AGENT_RUNTIME_LIMITS.faultDetailsBytes) break;
    boundedFailures.push(copied);
  }
  const truncated = boundedFailures.length < failures.length;
  return new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.recovery_failed' as const,
      message: AGENT_FAULT_MESSAGES.recoveryFailed,
      phase: 'initializing' as const,
      retryable: false,
      details: Object.freeze({
        failures: Object.freeze(boundedFailures),
        truncated,
      }),
    }),
  );
};

const initializeLimitInvalidError = (): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.limit_invalid' as const,
      message: AGENT_FAULT_MESSAGES.limitInvalid,
      phase: 'initializing' as const,
      retryable: false,
      details: Object.freeze({
        operation: 'initialize',
        limit: AGENT_RUNTIME_LIMITS.activeSnapshots,
      }),
    }),
  );

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.length &&
    keys.every((key) => ownKeys.includes(key)) &&
    ownKeys.every((key) => typeof key === 'string')
  );
};

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

const recoveryCodePointAt = (value: string, index: number): number | undefined => {
  const codePoint = value.codePointAt(index);
  return codePoint === undefined || (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ? undefined
    : codePoint;
};

const validRecoveryIdentifier = (value: string): boolean => {
  if (value.length === 0 || value.length > AGENT_RUNTIME_LIMITS.agentIdentityBytes) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = recoveryCodePointAt(value, index);
    if (codePoint === undefined) return false;
    if (codePoint > 0xffff) index += 1;
  }
  return utf8Bytes(value).byteLength <= AGENT_RUNTIME_LIMITS.agentIdentityBytes;
};

const validateAndCopyRows = (
  refs: readonly unknown[],
):
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'valid'; snapshots: readonly ActiveInvocationSnapshot[] }> => {
  const snapshots: ActiveInvocationSnapshot[] = [];
  const invocationIds = new Set<string>();
  try {
    for (const ref of refs) {
      if (!isPlainRecord(ref) || !hasExactKeys(ref, ['invocationId', 'pin', 'state', 'process']))
        return Object.freeze({ status: 'invalid' });
      const pin = ref.pin;
      const process = ref.process;
      const pid = isPlainRecord(process) ? process.pid : undefined;
      const processGroupId = isPlainRecord(process) ? process.processGroupId : undefined;
      if (
        !isPlainRecord(pin) ||
        !hasExactKeys(pin, ['agentId', 'agentVersion', 'definitionDigest']) ||
        typeof pin.agentId !== 'string' ||
        !validRecoveryIdentifier(pin.agentId) ||
        typeof pin.agentVersion !== 'string' ||
        !validRecoveryIdentifier(pin.agentVersion) ||
        typeof pin.definitionDigest !== 'string' ||
        pin.definitionDigest.length === 0 ||
        typeof ref.invocationId !== 'string' ||
        !validRecoveryIdentifier(ref.invocationId) ||
        (ref.state !== 'running' && ref.state !== 'cancelling') ||
        !isPlainRecord(process) ||
        !hasExactKeys(process, ['pid', 'processGroupId', 'fingerprint', 'startedAt']) ||
        !isPositiveSafeInteger(pid) ||
        !isPositiveSafeInteger(processGroupId) ||
        typeof process.fingerprint !== 'string' ||
        process.fingerprint.length === 0 ||
        typeof process.startedAt !== 'string' ||
        process.startedAt.length === 0 ||
        invocationIds.has(ref.invocationId)
      )
        return Object.freeze({ status: 'invalid' });
      invocationIds.add(ref.invocationId);
      snapshots.push(
        Object.freeze({
          invocationId: ref.invocationId,
          pin: Object.freeze({
            agentId: pin.agentId,
            agentVersion: pin.agentVersion,
            definitionDigest: pin.definitionDigest,
          }),
          state: ref.state,
          process: Object.freeze({
            pid,
            processGroupId,
            fingerprint: process.fingerprint,
            startedAt: process.startedAt,
          }),
        }),
      );
    }
  } catch {
    return Object.freeze({ status: 'invalid' });
  }
  return Object.freeze({ status: 'valid', snapshots: Object.freeze(snapshots) });
};

const shutdownFailedError = (
  failures: readonly ShutdownDrainResult[],
  reason: string | undefined,
): AgentManagerError => {
  const first = failures.find((failure) => failure.kind !== 'recovery_incomplete');
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
  let redacted = reason;
  for (const secret of secretValues) {
    if (secret.length > 0) redacted = redacted.split(secret).join('[REDACTED]');
  }
  return textDecoder.decode(utf8Bytes(redacted).slice(0, AGENT_RUNTIME_LIMITS.descriptionBytes));
};

type ShutdownDrainResult =
  | Readonly<{ invocationId: string; kind: 'terminal' }>
  | Readonly<{
      invocationId: string;
      kind: 'cleanup_failed';
      outcome: ProcessCleanupAttemptOutcome;
    }>
  | Readonly<{ kind: 'recovery_incomplete' }>
  | Readonly<{ invocationId: string; kind: 'recovery_cleanup_uncertain' }>;

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
  completion: Deferred<AgentInvocationResult>,
): LifecycleHandle =>
  Object.freeze({
    invocationId,
    result: () => completion.promise,
  });

const settledBefore = (operation: Promise<unknown>, deadlineAt: number): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(0, deadlineAt - Date.now()));
    timer.unref?.();
    void operation.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });

class InternalInvocationLifecycleManager {
  readonly #configuredSecretValues: readonly string[];
  readonly #activeStateOperationTimeoutMs: number;
  readonly #initializationTimeoutMs: number;
  #closing = false;
  #shutdownDeferred: Deferred<void> | undefined;
  #initialized: 'pending' | 'ready' | 'failed' = 'pending';
  #initializationDeferred: Deferred<void> | undefined;
  #initializationDeadlineAt = 0;
  readonly #uncertainRecoveryInvocationIds = new Set<string>();
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
  // Retained until consumer-backed active-state reconciliation can inspect uncertain rows.
  private readonly retainedActiveStateGuards = new Map<string, RetainedActiveStateGuard>();
  private readonly retainedActiveStateOutputDirectories = new Set<string>();
  constructor(
    private readonly ports: LifecycleManagerPorts,
    private readonly completed: CompletedInvocations,
    private readonly subscriptions: TerminalSubscriptions,
    private readonly registry: SealedAgentRegistry,
    private readonly installedBindings: InstalledBindingRegistry,
    private readonly effectiveInputValidators: ReadonlyMap<string, EffectiveInputValidators>,
    private readonly limits: Readonly<AgentManagerLimits>,
    private readonly activeStateSink: ActiveInvocationStateSink,
    configuredSecretValues: readonly string[],
  ) {
    this.#configuredSecretValues = configuredSecretValues;
    const activeStateOperationTimeoutMs = limits.activeStateOperationTimeoutMs;
    if (activeStateOperationTimeoutMs === undefined)
      throw new Error('Validated active-state operation timeout is required.');
    this.#activeStateOperationTimeoutMs = activeStateOperationTimeoutMs;
    const initializationTimeoutMs = limits.initializationTimeoutMs;
    if (initializationTimeoutMs === undefined)
      throw new Error('Validated initialization timeout is required.');
    this.#initializationTimeoutMs = initializationTimeoutMs;
    this.executionPort =
      ports.execution ?? createNativeProcessExecutionPort(undefined, activeStateOperationTimeoutMs);
  }

  initialize(snapshots: unknown): Promise<void> {
    if (this.#initializationDeferred !== undefined) return this.#initializationDeferred.promise;
    if (this.#closing) return Promise.reject(managerClosedError());

    this.#initializationDeadlineAt = Date.now() + this.#initializationTimeoutMs;
    this.#initializationDeferred = createDeferred<void>();
    const inspection = inspectBatchRefs(snapshots, AGENT_RUNTIME_LIMITS.activeSnapshots);
    const rows = inspection.status === 'valid' ? validateAndCopyRows(inspection.refs) : undefined;
    void this.#settleInitialization(inspection, rows).then(
      () => {
        this.#initialized = 'ready';
        this.#initializationDeferred?.resolve(undefined);
      },
      (error_: unknown) => {
        this.#initialized = 'failed';
        this.#initializationDeferred?.reject(error_);
      },
    );
    return this.#initializationDeferred.promise;
  }

  #startReadinessRejection(): LifecycleStartOutcome | undefined {
    if (this.#closing) return Object.freeze({ status: 'rejected', reason: 'manager_closed' });
    if (this.#initialized !== 'ready')
      return Object.freeze({
        status: 'rejected',
        reason: this.#initialized === 'failed' ? 'manager_closed' : 'manager_not_initialized',
      });
    return undefined;
  }

  async start(input: unknown, context?: unknown): Promise<LifecycleStartOutcome> {
    const notReady = this.#startReadinessRejection();
    if (notReady !== undefined) return notReady;
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
      if (this.retainedActiveStateOutputDirectories.has(plan.outputDirectory))
        return Object.freeze({ status: 'rejected', reason: 'active_state_failed' });
      const claimOutcome = await this.resolveClaimedSession(snapshot.invocationId, plan);
      if (claimOutcome.status === 'rejected')
        return Object.freeze({ status: 'rejected', reason: claimOutcome.reason });
      const preparation = await this.prepareOutput(
        snapshot,
        preparedLaunch,
        plan,
        claimOutcome.session,
      );
      if (preparation.status === 'rejected')
        return Object.freeze({ status: 'rejected', reason: preparation.reason });
      const { resources, authority } = preparation;
      const admission = await this.admitProcessAndSaveActiveState(
        snapshot,
        preparedLaunch,
        plan,
        resources,
      );
      if (admission.status === 'rejected')
        return Object.freeze({ status: 'rejected', reason: admission.reason });
      const { activate, startedAt, activeStateLane, activeProcessIdentity } = admission;
      const acceptedAt = createIsoTimestamp();

      const completion = createDeferred<AgentInvocationResult>();
      const lifecycle = new InvocationLifecycle(
        Object.freeze({ ...this.ports, execution: this.executionPort }),
        snapshot,
        preparedLaunch,
        activate,
        authority,
        acceptedAt,
        startedAt,
        () => {
          void activeStateLane.save(
            this.createActiveStateSnapshot(
              snapshot.invocationId,
              preparedLaunch,
              'cancelling',
              activeProcessIdentity,
            ),
            Date.now() + this.#activeStateOperationTimeoutMs,
          );
        },
        async (invocationId) => {
          const removed = await activeStateLane.remove(
            invocationId,
            Date.now() + this.#activeStateOperationTimeoutMs,
          );
          if (!removed)
            this.retainActiveStateGuard(invocationId, {
              activeStateLane,
              killAndReap: async () => undefined,
              outputDirectory: plan.outputDirectory,
              cleanupConfirmed: true,
            });
        },
        (result) => this.complete(snapshot.invocationId, completion, result),
      );
      this.active.set(
        snapshot.invocationId,
        Object.freeze({
          acceptedAt,
          completion,
          lifecycle,
        }),
      );
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

  private async prepareOutput(
    snapshot: InvocationInputSnapshot,
    preparedLaunch: PreparedLaunch,
    plan: OutputResourcePlan,
    session: Extract<OutputClaimResult, { status: 'claimed' }>['session'],
  ): Promise<
    | Readonly<{
        status: 'accepted';
        resources: NonNullable<ReturnType<typeof takePreparedInvocationResourcesPayload>>;
        authority: TerminalPublicationAuthority;
      }>
    | Readonly<{ status: 'rejected'; reason: RejectionReason }>
  > {
    const preparation = this.createOutputPreparation(snapshot, preparedLaunch, plan, session);
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
    return Object.freeze({
      status: 'accepted' as const,
      resources: preparationResult.resources,
      authority: preparationResult.authority,
    });
  }

  private async admitProcessAndSaveActiveState(
    snapshot: InvocationInputSnapshot,
    preparedLaunch: PreparedLaunch,
    plan: OutputResourcePlan,
    resources: NonNullable<ReturnType<typeof takePreparedInvocationResourcesPayload>>,
  ): Promise<
    | Readonly<{
        status: 'accepted';
        activate: () => RunningExecution;
        startedAt: string;
        activeStateLane: ActiveStateLane;
        activeProcessIdentity: ActiveProcessIdentity;
      }>
    | Readonly<{ status: 'rejected'; reason: RejectionReason }>
  > {
    const spawn = await this.executionPort.spawnAndIdentify(snapshot, preparedLaunch, resources);
    if (spawn.status === 'failed') {
      if (spawn.cleanupOutcome !== undefined) {
        this.retainActiveStateGuard(snapshot.invocationId, {
          activeStateLane: new ActiveStateLane(
            this.activeStateSink,
            this.#activeStateOperationTimeoutMs,
          ),
          killAndReap: async () => spawn.cleanupOutcome,
          outputDirectory: plan.outputDirectory,
          cleanupConfirmed: false,
        });
      }
      return Object.freeze({
        status: 'rejected',
        reason: spawn.reason === 'identity_failed' ? 'process_identity_failed' : 'preflight_failed',
      });
    }

    const activeStateLane = new ActiveStateLane(
      this.activeStateSink,
      this.#activeStateOperationTimeoutMs,
    );
    const activeProcessIdentity: ActiveProcessIdentity = Object.freeze({
      pid: spawn.identity.pid,
      processGroupId: spawn.identity.processGroupId,
      fingerprint: spawn.identity.fingerprint,
      startedAt: spawn.startedAt,
    });
    const runningActiveState = this.createActiveStateSnapshot(
      snapshot.invocationId,
      preparedLaunch,
      'running',
      activeProcessIdentity,
    );
    const retainedGuard: RetainedActiveStateGuard = {
      activeStateLane,
      killAndReap: spawn.killAndReap,
      outputDirectory: plan.outputDirectory,
      cleanupConfirmed: false,
    };

    if (this.#closing) {
      const cleanupOutcome = await spawn.killAndReap();
      if (cleanupOutcome !== undefined)
        this.retainActiveStateGuard(snapshot.invocationId, retainedGuard);
      return Object.freeze({ status: 'rejected', reason: 'manager_closed' });
    }

    this.retainActiveStateGuard(snapshot.invocationId, retainedGuard);
    const preacceptanceDeadlineAt =
      spawn.spawnedAt + Math.min(snapshot.wallClockTimeoutMs, snapshot.limits.idleTimeoutMs);
    const setupDeadlineAt = Math.min(
      spawn.spawnedAt + this.#activeStateOperationTimeoutMs,
      preacceptanceDeadlineAt,
    );
    const runningSave = await activeStateLane.save(runningActiveState, setupDeadlineAt);
    if (runningSave.status !== 'fulfilled') {
      await this.killReapAndMaybeCompensate(
        snapshot.invocationId,
        retainedGuard,
        activeStateLane,
        runningSave.status === 'timed_out',
      );
      return Object.freeze({ status: 'rejected', reason: 'active_state_failed' });
    }

    if (this.#closing) {
      await this.killReapAndMaybeCompensate(
        snapshot.invocationId,
        retainedGuard,
        activeStateLane,
        true,
      );
      return Object.freeze({ status: 'rejected', reason: 'manager_closed' });
    }

    this.releaseActiveStateGuard(snapshot.invocationId);
    return Object.freeze({
      status: 'accepted' as const,
      activate: spawn.activate,
      startedAt: spawn.startedAt,
      activeStateLane,
      activeProcessIdentity,
    });
  }

  private async killReapAndMaybeCompensate(
    invocationId: string,
    retainedGuard: RetainedActiveStateGuard,
    activeStateLane: ActiveStateLane,
    attemptCompensatingRemove: boolean,
  ): Promise<void> {
    const cleanupOutcome = await retainedGuard.killAndReap();
    retainedGuard.cleanupConfirmed = cleanupOutcome === undefined;
    if (!attemptCompensatingRemove || cleanupOutcome !== undefined) return;
    const removed = await activeStateLane.remove(
      invocationId,
      Date.now() + this.#activeStateOperationTimeoutMs,
    );
    if (removed) this.releaseActiveStateGuard(invocationId);
  }

  getResult(invocationId: string): AgentResultLookup {
    this.#assertReady();
    const active = this.active.get(invocationId);
    if (active !== undefined)
      return Object.freeze({ state: 'running', invocation: activeSnapshot(invocationId, active) });

    const result = this.completed.get(invocationId);
    return result === undefined
      ? Object.freeze({ state: 'unknown' })
      : Object.freeze({ state: 'completed', result });
  }

  waitForResult(invocationId: string): Promise<AgentInvocationResult> {
    this.#assertReady();
    const active = this.active.get(invocationId);
    if (active !== undefined) return active.completion.promise;

    const result = this.completed.get(invocationId);
    return result === undefined
      ? Promise.reject(invocationUnknownError())
      : Promise.resolve(result);
  }

  cancel(invocationId: string): Promise<CancelInvocationResult> {
    this.#assertReady();
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
    const result = this.completed.get(invocationId);
    if (result !== undefined)
      return Promise.resolve(Object.freeze({ state: 'already_completed' as const, result }));
    return Promise.resolve(Object.freeze({ state: 'unknown' as const }));
  }

  getInvocation(invocationId: string): AgentInvocationSnapshot | undefined {
    this.#assertReady();
    const active = this.active.get(invocationId);
    if (active !== undefined) return activeSnapshot(invocationId, active);
    const result = this.completed.get(invocationId);
    return result === undefined ? undefined : retainedSnapshot(result);
  }

  listInvocations(filter?: AgentInvocationFilter): readonly AgentInvocationSnapshot[] {
    this.#assertReady();
    const snapshots = [
      ...[...this.active.entries()].map(([invocationId, active]) =>
        activeSnapshot(invocationId, active),
      ),
      ...this.completed.values().map((result) => retainedSnapshot(result)),
    ];
    return Object.freeze(
      snapshots
        .filter((snapshot) => matchesFilter(snapshot, filter))
        .toSorted(compareInvocationSnapshots),
    );
  }

  subscribe(filter: unknown, listener: TerminalEventListener): TerminalSubscriptionAdmission {
    if (this.#closing) throw managerClosedError();
    this.#assertReady();
    return this.subscriptions.subscribe(filter, listener);
  }

  #assertReady(): void {
    if (this.#initialized === 'ready') return;
    throw this.#initialized === 'failed' ? managerClosedError() : managerNotInitializedError();
  }

  async #settleInitialization(
    inspection: BatchInspection,
    rows: ReturnType<typeof validateAndCopyRows> | undefined,
  ): Promise<void> {
    await Promise.resolve();
    if (inspection.status === 'invalid') throw recoveryInvalidError();
    if (inspection.status === 'limit') throw initializeLimitInvalidError();

    if (rows === undefined || rows.status === 'invalid') throw recoveryInvalidError();
    if (rows.snapshots.length === 0) return;
    if (!isRecoverySupportedPlatform())
      throw recoveryFailedError(
        rows.snapshots
          .toSorted((left, right) => compareStrings(left.invocationId, right.invocationId))
          .map((snapshot) =>
            Object.freeze({
              invocationId: snapshot.invocationId,
              category: 'platform_unsupported' as const,
            }),
          ),
      );
    const failures = await reconcileRecoveredRows(
      rows.snapshots,
      this.registry,
      this.executionPort,
      this.activeStateSink,
      this.#activeStateOperationTimeoutMs,
      this.#initializationDeadlineAt,
      Object.freeze({
        isClosing: () => this.#closing,
        onTerminationUnconfirmed: (invocationId: string) => {
          this.#uncertainRecoveryInvocationIds.add(invocationId);
        },
      }),
    );
    if (failures.length > 0) throw recoveryFailedError(failures);
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
    const recoveryIncomplete = await this.#drainPendingInitialization();
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
    const retainedActiveStateDrains = [...this.retainedActiveStateGuards.entries()].map(
      ([invocationId, guard]) => this.drainRetainedActiveStateGuard(invocationId, guard),
    );
    const results = await Promise.all([...activeDrains, ...retainedActiveStateDrains]);
    const failures: ShutdownDrainResult[] = results.filter(
      (result): result is Extract<ShutdownDrainResult, { kind: 'cleanup_failed' }> =>
        result.kind === 'cleanup_failed',
    );
    if (recoveryIncomplete) failures.push(Object.freeze({ kind: 'recovery_incomplete' as const }));
    for (const invocationId of this.#uncertainRecoveryInvocationIds)
      failures.push(Object.freeze({ invocationId, kind: 'recovery_cleanup_uncertain' as const }));
    if (failures.length > 0) throw shutdownFailedError(failures, this.#firstShutdownReason);
    this.subscriptions.clear();
  }

  async #drainPendingInitialization(): Promise<boolean> {
    if (this.#initializationDeferred === undefined) return false;
    const settled = await settledBefore(
      this.#initializationDeferred.promise,
      this.#initializationDeadlineAt,
    );
    return !settled;
  }

  private async drainRetainedActiveStateGuard(
    invocationId: string,
    guard: RetainedActiveStateGuard,
  ): Promise<ShutdownDrainResult> {
    if (!guard.cleanupConfirmed) {
      const outcome = await guard.killAndReap();
      if (outcome !== undefined)
        return Object.freeze({ invocationId, kind: 'cleanup_failed' as const, outcome });
      guard.cleanupConfirmed = true;
    }
    const removed = await guard.activeStateLane.remove(
      invocationId,
      Date.now() + this.#activeStateOperationTimeoutMs,
    );
    if (removed) this.releaseActiveStateGuard(invocationId);
    return Object.freeze({ invocationId, kind: 'terminal' as const });
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
    completion: Deferred<AgentInvocationResult>,
    result: AgentInvocationResult,
  ): void {
    const active = this.active.get(invocationId);
    if (active === undefined) throw new Error('Completed invocation is not active.');
    this.completed.commit(invocationId, result);
    this.active.delete(invocationId);
    const event: TerminalInvocationEvent = Object.freeze({
      type: 'invocation.finished',
      invocationId,
    });
    try {
      this.subscriptions.deliver(event);
    } finally {
      completion.resolve(result);
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
      this.quarantinedPreparationInvocationIds.has(invocationId) ||
      this.retainedActiveStateGuards.has(invocationId)
    )
      return false;
    this.pending.add(invocationId);
    return true;
  }

  private createActiveStateSnapshot(
    invocationId: string,
    preparedLaunch: PreparedLaunch,
    state: ActiveInvocationSnapshot['state'],
    process: ActiveProcessIdentity,
  ): ActiveInvocationSnapshot {
    return Object.freeze({
      invocationId,
      pin: Object.freeze({ ...preparedLaunch.pin }),
      state,
      process: Object.freeze({ ...process }),
    });
  }

  private retainActiveStateGuard(invocationId: string, guard: RetainedActiveStateGuard): void {
    this.retainedActiveStateGuards.set(invocationId, guard);
    this.retainedActiveStateOutputDirectories.add(guard.outputDirectory);
  }

  private releaseActiveStateGuard(invocationId: string): void {
    const guard = this.retainedActiveStateGuards.get(invocationId);
    if (guard === undefined) return;
    this.retainedActiveStateGuards.delete(invocationId);
    const outputStillRetained = [...this.retainedActiveStateGuards.values()].some(
      (candidate) => candidate.outputDirectory === guard.outputDirectory,
    );
    if (!outputStillRetained)
      this.retainedActiveStateOutputDirectories.delete(guard.outputDirectory);
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

  private async resolveClaimedSession(
    invocationId: string,
    plan: OutputResourcePlan,
  ): Promise<
    | Readonly<{
        status: 'accepted';
        session: Extract<OutputClaimResult, { status: 'claimed' }>['session'];
      }>
    | Readonly<{ status: 'rejected'; reason: 'output_claim_failed' | 'output_claim_uncertain' }>
  > {
    const claim = await this.claimInvocationOutput(plan);
    if (this.#closing) {
      if (claim?.status === 'uncertain') {
        this.quarantinedInvocationIds.set(invocationId, claim.guard);
        this.quarantinedOutputDirectories.add(plan.outputDirectory);
        return Object.freeze({ status: 'rejected', reason: 'output_claim_uncertain' });
      }
      return Object.freeze({ status: 'rejected', reason: 'output_claim_failed' });
    }
    if (claim === undefined || claim.status === 'rejected')
      return Object.freeze({ status: 'rejected', reason: 'output_claim_failed' });
    if (claim.status === 'uncertain') {
      this.quarantinedInvocationIds.set(invocationId, claim.guard);
      this.quarantinedOutputDirectories.add(plan.outputDirectory);
      return Object.freeze({ status: 'rejected', reason: 'output_claim_uncertain' });
    }
    return Object.freeze({ status: 'accepted', session: claim.session });
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
  initialize(snapshots: readonly ActiveInvocationSnapshot[]): Promise<void>;
  cancel(invocationId: string): Promise<CancelInvocationResult>;
  getInvocation(invocationId: string): AgentInvocationSnapshot | undefined;
  getResult(invocationId: string): AgentResultLookup;
  listInvocations(filter?: AgentInvocationFilter): readonly AgentInvocationSnapshot[];
  start(input: unknown, context?: unknown): Promise<LifecycleStartOutcome>;
  subscribe(filter: unknown, listener: TerminalEventListener): TerminalSubscriptionAdmission;
  shutdown(reason?: string): Promise<void>;
  waitForResult(invocationId: string): Promise<AgentInvocationResult>;
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
      validated.activeStateSink,
      validated.redaction.secrets,
    ),
  );
};
