import type {
  CompiledConsumerSchema,
  compileConsumerSchema,
  ComparatorOperator,
  ConsumerSchemaProfileValidation,
  createDefinitionIdentity,
  DefinitionIdentity,
  ExecutableVersionConstraint,
  matchesExecutableVersionConstraint,
  normalizeValidationDiagnostics,
  parseExecutableVersionConstraint,
  parseStrictSemVer,
  compareSemVer,
  StrictSemVer,
  ValidationDiagnosticInput,
  validateConsumerSchemaProfile,
  VersionComparator,
  parseAndClassifyAgentDefinition,
  RawAgentDefinition,
  validateManagerOptions,
  ValidatedDefinition,
  ValidatedManagerConstruction,
} from '../../src/runtime/definition/index.js';
import type {
  captureChildEnvironment,
  ChildEnvironmentCapture,
  ChildEnvironmentRequest,
  ConsumedOutputPreparationMaterial,
  ConsumedRedactionMaterial,
  PreparedInvocationMaterial,
  PreparedInvocation,
  OutputPreparationFileSlot,
  ExecutionBinding,
  beginOutputClaim,
  createRedactingBoundedOutputSink,
  createRedactionChannel,
  createOutputClaimAttempt,
  ClaimedInvocationOutput,
  inspectOutputClaimGuard,
  InvocationExecutionPorts,
  InvocationInputSnapshot,
  InvocationTerminalObservation,
  LiveOwnedProcess,
  NormalizedInvocationOutcome,
  OutputClaimAttempt,
  OutputClaimExclusiveCreatePort,
  OutputClaimExclusiveCreateRequest,
  OutputClaimGuard,
  OutputClaimPlatformResult,
  OutputClaimQuiescence,
  OutputClaimReconciliation,
  OutputClaimResult,
  OutputPreparationAttempt,
  OutputPreparationMutationPort,
  OutputPreparationMutationRequest,
  OutputPreparationPlatformResult,
  OutputPreparationQuiescence,
  OutputPreparationResult,
  PreparedInvocationPayloads,
  OutputResourcePlan,
  PreparedInvocationResources,
  PreparedExecutionSecurity,
  PreparedExecutionSecurityRequest,
  PreparedLaunch,
  ProcessExitObservation,
  ProcessIdentity,
  ProcessOutputSink,
  ProcessStartRequest,
  ProcessSupervisionPort,
  RedactingBoundedOutputSink,
  RedactingOutputGuardRequest,
  RedactionChannel,
  RegisteredSecrets,
  registerSecrets,
  revealRegisteredSecrets,
  SealedSecretRegistration,
  SecretRegistrationRequest,
  TerminalPublicationAuthority,
  WorkspaceAdmissionResult,
} from '../../src/runtime/execution/index.js';
import type {
  ExecutableProbePort,
  ExecutableResolution,
  parseVersionOutput,
  ProbeHostPlatform,
  RunningVersionProbe,
  VersionProbeObservation,
  VersionProbeRequest,
  VersionOutputFailureReason,
  VersionOutputResult,
} from '../../src/runtime/probe/index.js';
import type {
  AgentArgumentTemplate,
  AgentDefinitionContract,
  AgentDefinitionInput,
  AgentDescriptor,
  AgentFault,
  AgentFaultCode,
  AgentManagerLimits,
  AgentManagerOptions,
  AgentProbeAvailable,
  AgentProbeResult,
  AgentProbeUnavailable,
  AgentRef,
  AgentValidationDetails,
  AgentValidationDiagnostic,
  AgentVersionProbe,
  JsonObject,
  JsonPrimitive,
  JsonSchema202012,
  JsonValue,
} from '../../src/runtime/spec/index.js';

type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;

type Expect<Value extends true> = Value;

type ExpectedAgentFaultCode =
  | 'revo.agent.definition_invalid'
  | 'revo.agent.definition_duplicate'
  | 'revo.agent.strategy_unsupported'
  | 'revo.agent.limit_invalid'
  | 'revo.agent.agent_unknown'
  | 'revo.agent.platform_unsupported'
  | 'revo.agent.probe_platform_unsupported'
  | 'revo.agent.probe_spawn_failed'
  | 'revo.agent.probe_timeout'
  | 'revo.agent.probe_output_too_large'
  | 'revo.agent.probe_process_failed'
  | 'revo.agent.probe_output_invalid'
  | 'revo.agent.probe_version_mismatch'
  | 'revo.agent.internal';

type ExpectedValidationDiagnosticInput = {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message: string;
};

export type AgentFaultCodeIsExact = Expect<Equal<AgentFaultCode, ExpectedAgentFaultCode>>;

export type ValidationDiagnosticInputIsExact = Expect<
  Equal<ValidationDiagnosticInput, ExpectedValidationDiagnosticInput>
>;

export type NormalizeValidationDiagnosticsIsExact = Expect<
  Equal<
    typeof normalizeValidationDiagnostics,
    (inputs: readonly ValidationDiagnosticInput[]) => AgentValidationDetails
  >
>;

type ExpectedConsumerSchemaProfileValidation =
  | { readonly valid: true; readonly schema: JsonSchema202012 }
  | { readonly valid: false; readonly diagnostics: AgentValidationDetails };

export type ConsumerSchemaProfileValidationIsExact = Expect<
  Equal<ConsumerSchemaProfileValidation, ExpectedConsumerSchemaProfileValidation>
>;

type ExpectedDefinitionIdentity = {
  readonly digest: string;
  readonly snapshot: JsonObject;
};

export type DefinitionIdentityIsExact = Expect<
  Equal<DefinitionIdentity, ExpectedDefinitionIdentity>
>;

export type CreateDefinitionIdentityIsExact = Expect<
  Equal<typeof createDefinitionIdentity, (value: JsonObject) => DefinitionIdentity>
>;

export type ValidateConsumerSchemaProfileIsExact = Expect<
  Equal<
    typeof validateConsumerSchemaProfile,
    (schema: unknown, instancePath: string) => ConsumerSchemaProfileValidation
  >
>;

export type CompiledConsumerSchemaIsExact = Expect<
  Equal<
    CompiledConsumerSchema,
    {
      validate(value: JsonValue, valueInstancePath: string): AgentValidationDetails | undefined;
    }
  >
>;

export type CompileConsumerSchemaIsExact = Expect<
  Equal<
    typeof compileConsumerSchema,
    (schema: JsonSchema202012, schemaInstancePath: string) => CompiledConsumerSchema
  >
>;

type ExpectedStrictSemVer = {
  readonly source: string;
  readonly core: readonly [string, string, string];
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
};

type ExpectedComparatorOperator = '=' | '>' | '>=' | '<' | '<=';

type ExpectedVersionComparator = {
  readonly operator: ComparatorOperator;
  readonly version: StrictSemVer;
};

type ExpectedExecutableVersionConstraint = {
  readonly source: string;
  readonly comparators: readonly VersionComparator[];
};

type ExpectedVersionOutputFailureReason =
  | 'invalid_utf8'
  | 'nul'
  | 'line_break'
  | 'surrounding_whitespace'
  | 'prefix_mismatch'
  | 'empty_version'
  | 'invalid_semver';

type ExpectedVersionOutputResult =
  | { readonly valid: true; readonly version: StrictSemVer }
  | { readonly valid: false; readonly reason: VersionOutputFailureReason };

type ExpectedProbeHostPlatform = 'darwin' | 'linux' | 'win32' | 'other';

type ExpectedExecutableResolution =
  | { readonly status: 'resolved'; readonly executable: string }
  | { readonly status: 'unavailable'; readonly reason: 'not_found' | 'not_launchable' };

type ExpectedVersionProbeRequest = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly shell: false;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: 65_536;
  readonly stderrLimitBytes: 65_536;
};

type ExpectedVersionProbeObservation =
  | {
      readonly status: 'exited';
      readonly exitCode: number | null;
      readonly signal: string | null;
      readonly stdout: Uint8Array;
      readonly stderr: Uint8Array;
      readonly overflow: 'none' | 'stdout' | 'stderr' | 'both';
    }
  | { readonly status: 'spawn_failed' };

type ExpectedRunningVersionProbe = {
  readonly completion: Promise<VersionProbeObservation>;
  readonly timeout: Promise<void>;
  terminateAndReap(): Promise<void>;
};

type ExpectedExecutableProbePort = {
  hostPlatform(): ProbeHostPlatform;
  resolveExecutable(request: Readonly<{ command: string }>): Promise<ExecutableResolution>;
  startVersionProbe(request: VersionProbeRequest): Promise<RunningVersionProbe>;
};

type ExpectedChildEnvironmentRequest = {
  readonly inherit: readonly string[];
  readonly variables: Readonly<Record<string, string>>;
  readonly secrets: Readonly<Record<string, string>>;
};

type ExpectedChildEnvironmentCapture =
  | {
      readonly status: 'captured';
      readonly environment: Readonly<Record<string, string>>;
      readonly secretValues: readonly string[];
    }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'invalid_request'
        | 'invalid_key'
        | 'credential_like_name'
        | 'duplicate_name'
        | 'missing_inherit_variable'
        | 'empty_secret_value'
        | 'too_many_keys'
        | 'key_too_large'
        | 'value_too_large'
        | 'total_size_exceeded';
    };

type ExpectedSecretRegistrationRequest = {
  readonly configuredSecrets: readonly string[];
  readonly invocationSecrets: readonly string[];
};

type ExpectedSealedSecretRegistration =
  | {
      readonly status: 'registered';
      readonly registeredSecrets: RegisteredSecrets;
    }
  | {
      readonly status: 'rejected';
      readonly reason: 'invalid_request' | 'empty_secret_value';
    };

type ExpectedRedactionChannel = {
  feed(chunk: Uint8Array): Uint8Array;
  flush(): Uint8Array;
  dispose(): void;
};

type ExpectedRedactingOutputGuardRequest = {
  readonly downstream: ProcessOutputSink;
  readonly secretValues: readonly string[];
  readonly maxBytes: number;
};

type ExpectedRedactingBoundedOutputSink = ProcessOutputSink & {
  dispose(): void;
  truncated(): boolean;
};

type ExpectedProcessStartRequest = {
  readonly cwd: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly stdout: ProcessOutputSink;
  readonly stderr: ProcessOutputSink;
};

type ExpectedProcessIdentity = {
  readonly pid: number;
  readonly processGroupId: number;
  readonly fingerprint: string;
};

type ExpectedLiveOwnedProcess = {
  readonly completion: Promise<ProcessExitObservation>;
  readonly identity: ProcessIdentity;
  terminateAndReap(): Promise<void>;
};

type ExpectedProcessSupervisionPort = {
  start(request: ProcessStartRequest): Promise<LiveOwnedProcess>;
};

export type StrictSemVerIsExact = Expect<Equal<StrictSemVer, ExpectedStrictSemVer>>;

export type ComparatorOperatorIsExact = Expect<
  Equal<ComparatorOperator, ExpectedComparatorOperator>
>;

export type VersionComparatorIsExact = Expect<Equal<VersionComparator, ExpectedVersionComparator>>;

export type ExecutableVersionConstraintIsExact = Expect<
  Equal<ExecutableVersionConstraint, ExpectedExecutableVersionConstraint>
>;

export type ParseStrictSemVerIsExact = Expect<
  Equal<typeof parseStrictSemVer, (value: string) => StrictSemVer | undefined>
>;

export type CompareSemVerIsExact = Expect<
  Equal<typeof compareSemVer, (left: StrictSemVer, right: StrictSemVer) => -1 | 0 | 1>
>;

export type ParseExecutableVersionConstraintIsExact = Expect<
  Equal<
    typeof parseExecutableVersionConstraint,
    (value: string) => ExecutableVersionConstraint | undefined
  >
>;

export type MatchesExecutableVersionConstraintIsExact = Expect<
  Equal<
    typeof matchesExecutableVersionConstraint,
    (version: StrictSemVer, constraint: ExecutableVersionConstraint) => boolean
  >
>;

export type VersionOutputFailureReasonIsExact = Expect<
  Equal<VersionOutputFailureReason, ExpectedVersionOutputFailureReason>
>;

export type VersionOutputResultIsExact = Expect<
  Equal<VersionOutputResult, ExpectedVersionOutputResult>
>;

export type ProbeHostPlatformIsExact = Expect<Equal<ProbeHostPlatform, ExpectedProbeHostPlatform>>;

export type ExecutableResolutionIsExact = Expect<
  Equal<ExecutableResolution, ExpectedExecutableResolution>
>;

export type VersionProbeRequestIsExact = Expect<
  Equal<VersionProbeRequest, ExpectedVersionProbeRequest>
>;

export type VersionProbeObservationIsExact = Expect<
  Equal<VersionProbeObservation, ExpectedVersionProbeObservation>
>;

export type RunningVersionProbeIsExact = Expect<
  Equal<RunningVersionProbe, ExpectedRunningVersionProbe>
>;

export type ExecutableProbePortIsExact = Expect<
  Equal<ExecutableProbePort, ExpectedExecutableProbePort>
>;

export type ChildEnvironmentRequestIsExact = Expect<
  Equal<ChildEnvironmentRequest, ExpectedChildEnvironmentRequest>
>;

export type ChildEnvironmentCaptureIsExact = Expect<
  Equal<ChildEnvironmentCapture, ExpectedChildEnvironmentCapture>
>;

export type CaptureChildEnvironmentIsExact = Expect<
  Equal<
    typeof captureChildEnvironment,
    (request: unknown, hostSnapshot: Readonly<Record<string, string>>) => ChildEnvironmentCapture
  >
>;

export type SecretRegistrationRequestIsExact = Expect<
  Equal<SecretRegistrationRequest, ExpectedSecretRegistrationRequest>
>;

export type SealedSecretRegistrationIsExact = Expect<
  Equal<SealedSecretRegistration, ExpectedSealedSecretRegistration>
>;

export type RegisterSecretsIsExact = Expect<
  Equal<typeof registerSecrets, (request: SecretRegistrationRequest) => SealedSecretRegistration>
>;

export type RevealRegisteredSecretsIsExact = Expect<
  Equal<typeof revealRegisteredSecrets, (capability: unknown) => readonly string[] | undefined>
>;

export type RedactionChannelIsExact = Expect<Equal<RedactionChannel, ExpectedRedactionChannel>>;

export type CreateRedactionChannelIsExact = Expect<
  Equal<typeof createRedactionChannel, (secretValues: readonly string[]) => RedactionChannel>
>;

export type RedactingOutputGuardRequestIsExact = Expect<
  Equal<RedactingOutputGuardRequest, ExpectedRedactingOutputGuardRequest>
>;

export type RedactingBoundedOutputSinkIsExact = Expect<
  Equal<RedactingBoundedOutputSink, ExpectedRedactingBoundedOutputSink>
>;

export type CreateRedactingBoundedOutputSinkIsExact = Expect<
  Equal<
    typeof createRedactingBoundedOutputSink,
    (
      request: RedactingOutputGuardRequest,
      channelFactory?: (secretValues: readonly string[]) => RedactionChannel,
    ) => RedactingBoundedOutputSink
  >
>;

export type ProcessStartRequestIsExact = Expect<
  Equal<ProcessStartRequest, ExpectedProcessStartRequest>
>;

export type ProcessIdentityIsExact = Expect<Equal<ProcessIdentity, ExpectedProcessIdentity>>;

export type LiveOwnedProcessIsExact = Expect<Equal<LiveOwnedProcess, ExpectedLiveOwnedProcess>>;

export type ProcessSupervisionPortIsExact = Expect<
  Equal<ProcessSupervisionPort, ExpectedProcessSupervisionPort>
>;

export type ParseVersionOutputIsExact = Expect<
  Equal<
    typeof parseVersionOutput,
    (input: {
      readonly bytes: Uint8Array;
      readonly prefix?: string | undefined;
    }) => VersionOutputResult
  >
>;

export type RawAgentDefinitionEqualsInput = Expect<Equal<RawAgentDefinition, AgentDefinitionInput>>;

export type ParseAndClassifyReturnsContract = Expect<
  Equal<ReturnType<typeof parseAndClassifyAgentDefinition>, AgentDefinitionContract>
>;

type ExpectedValidatedDefinition = {
  readonly definition: AgentDefinitionContract;
  readonly definitionDigest: string;
};

type ExpectedValidatedManagerConstruction = {
  readonly definitions: readonly ValidatedDefinition[];
  readonly limits: Readonly<AgentManagerLimits>;
  readonly redaction: Readonly<{ readonly secrets: readonly string[] }>;
};

export type ValidatedDefinitionIsExact = Expect<
  Equal<ValidatedDefinition, ExpectedValidatedDefinition>
>;

export type ValidatedManagerConstructionIsExact = Expect<
  Equal<ValidatedManagerConstruction, ExpectedValidatedManagerConstruction>
>;

export type ValidateManagerOptionsIsExact = Expect<
  Equal<typeof validateManagerOptions, (value: unknown) => ValidatedManagerConstruction>
>;

export type CohesiveSpecificationSurface = readonly [
  AgentFault,
  AgentFaultCode,
  AgentValidationDiagnostic,
  AgentValidationDetails,
  AgentProbeAvailable,
  AgentProbeUnavailable,
  AgentProbeResult,
  AgentManagerLimits,
  AgentManagerOptions,
  AgentRef,
  AgentDescriptor,
  AgentDefinitionContract,
  AgentDefinitionInput,
];

export type RuntimeContractSurface = readonly [
  AgentArgumentTemplate,
  AgentDefinitionContract,
  AgentDefinitionInput,
  AgentDescriptor,
  AgentFault,
  AgentManagerLimits,
  AgentManagerOptions,
  AgentProbeAvailable,
  AgentProbeResult,
  AgentProbeUnavailable,
  AgentRef,
  AgentValidationDetails,
  AgentValidationDiagnostic,
  AgentVersionProbe,
  JsonObject,
  JsonPrimitive,
  JsonSchema202012,
  JsonValue,
];

type ExpectedOutputClaimResult =
  | Readonly<{ status: 'claimed'; session: ClaimedInvocationOutput }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'cancelled_before_dispatch'
        | 'leaf_exists'
        | 'create_failed'
        | 'internal_before_dispatch';
    }>
  | Readonly<{
      status: 'uncertain';
      reason: 'claim_timeout' | 'claim_state_unknown';
      guard: OutputClaimGuard;
    }>;

type ExpectedOutputClaimQuiescence =
  | Readonly<{ status: 'quiescent'; syscallDispatched: boolean }>
  | Readonly<{ status: 'retained'; guard: OutputClaimGuard }>;

type ExpectedOutputClaimReconciliation =
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'claimed'; session: ClaimedInvocationOutput }>
  | Readonly<{ status: 'unknown'; reason: 'pending' | 'unreconciled' | 'deadline' }>;

type ExpectedOutputClaimAttempt = {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly settlement: Promise<OutputClaimResult>;
  readonly quiescence: Promise<OutputClaimQuiescence>;
  requestCancellation(): void;
};

type ExpectedOutputClaimPlatformResult =
  | Readonly<{ status: 'created' }>
  | Readonly<{ status: 'leaf_exists' }>
  | Readonly<{ status: 'create_failed' }>;

type ExpectedOutputClaimExclusiveCreateRequest = {
  readonly invocationId: string;
  readonly outputDirectory: string;
  markSyscallDispatched(): void;
};

type ExpectedOutputClaimExclusiveCreatePort = {
  createExclusiveOutputDirectory(
    request: OutputClaimExclusiveCreateRequest,
  ): Promise<OutputClaimPlatformResult>;
};

export type OutputClaimResultIsExact = Expect<Equal<OutputClaimResult, ExpectedOutputClaimResult>>;

export type OutputClaimQuiescenceIsExact = Expect<
  Equal<OutputClaimQuiescence, ExpectedOutputClaimQuiescence>
>;

export type OutputClaimAttemptIsExact = Expect<
  Equal<OutputClaimAttempt, ExpectedOutputClaimAttempt>
>;

export type OutputClaimReconciliationIsExact = Expect<
  Equal<OutputClaimReconciliation, ExpectedOutputClaimReconciliation>
>;

export type InspectOutputClaimGuardIsExact = Expect<
  Equal<typeof inspectOutputClaimGuard, (guard: unknown) => OutputClaimReconciliation>
>;

export type CreateOutputClaimAttemptIsExact = Expect<
  Equal<
    typeof createOutputClaimAttempt,
    (input: {
      readonly invocationId: string;
      readonly outputDirectory: string;
      readonly clock: {
        now(): number;
        schedule(delayMs: number, callback: () => void): () => void;
      };
      readonly port: OutputClaimExclusiveCreatePort;
    }) => OutputClaimAttempt
  >
>;

export type BeginOutputClaimIsExact = Expect<
  Equal<typeof beginOutputClaim, (attempt: OutputClaimAttempt) => void>
>;

export type OutputClaimPlatformResultIsExact = Expect<
  Equal<OutputClaimPlatformResult, ExpectedOutputClaimPlatformResult>
>;

export type OutputClaimExclusiveCreateRequestIsExact = Expect<
  Equal<OutputClaimExclusiveCreateRequest, ExpectedOutputClaimExclusiveCreateRequest>
>;

export type OutputClaimExclusiveCreatePortIsExact = Expect<
  Equal<OutputClaimExclusiveCreatePort, ExpectedOutputClaimExclusiveCreatePort>
>;

type ExpectedOutputPreparationResult =
  | Readonly<{
      status: 'prepared';
      resources: PreparedInvocationResources;
      authority: TerminalPublicationAuthority;
    }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'cancelled_before_mutation'
        | 'scratch_conflict'
        | 'scratch_create_failed'
        | 'scratch_write_failed'
        | 'scratch_flush_failed'
        | 'redaction_sink_create_failed'
        | 'evidence_open_failed'
        | 'internal_before_mutation';
      authority: TerminalPublicationAuthority;
    }>
  | Readonly<{
      status: 'uncertain';
      reason: 'preparation_timeout' | 'preparation_state_unknown';
      authority: TerminalPublicationAuthority;
    }>;

type ExpectedOutputPreparationQuiescence =
  | Readonly<{ status: 'quiescent'; mutationDispatched: boolean }>
  | Readonly<{ status: 'retained'; authority: TerminalPublicationAuthority }>;

type ExpectedOutputPreparationAttempt = {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly authority: TerminalPublicationAuthority;
  readonly settlement: Promise<OutputPreparationResult>;
  readonly quiescence: Promise<OutputPreparationQuiescence>;
  requestCancellation(): void;
};

type ExpectedConsumedOutputPreparationMaterial = {
  readonly invocationId: string;
  readonly outputDirectory: string;
};

type ExpectedExecutionBinding = {
  readonly protocolDriverId: 'native/stdio-v1' | 'acp/v1';
  readonly resultParserId?: 'codex-jsonl/v1' | 'claude-stream-json/v1';
  readonly permissionStrategyId: 'codex-cli/v1' | 'claude-cli/v1' | 'acp/v1';
  readonly delivery: {
    readonly prompt: 'argument' | 'stdin' | 'file' | 'protocol';
    readonly resultSchema: 'argument' | 'file' | 'protocol';
    readonly result: 'stdout' | 'protocol';
  };
};

type ExpectedOutputPreparationFileSlot = {
  readonly slot: 'prompt' | 'result-schema';
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly expectedByteLength: number;
  readonly expectedSha256: string;
};

type ExpectedPreparedInvocationMaterial = {
  readonly pin: Readonly<{ agentId: string; agentVersion: string; definitionDigest: string }>;
  readonly workspaceDirectory: string;
  readonly reportedVersion: string;
  readonly binding: ExecutionBinding;
  readonly outputResourcePlan: OutputResourcePlan;
  readonly preparedPayloads: PreparedInvocationPayloads;
};

type ExpectedPreparedExecutionSecurityRequest = {
  readonly invocationId: string;
  readonly childEnvironment: Readonly<Record<string, string>>;
  readonly registeredSecrets: RegisteredSecrets;
};

type ExpectedOutputPreparationMutationRequest = {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly material: ConsumedOutputPreparationMaterial;
  readonly redaction: ConsumedRedactionMaterial;
  markMutationDispatched(): void;
};

type ExpectedOutputPreparationPlatformResult =
  | Readonly<{ status: 'prepared' }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'scratch_conflict'
        | 'scratch_create_failed'
        | 'scratch_write_failed'
        | 'scratch_flush_failed'
        | 'redaction_sink_create_failed'
        | 'evidence_open_failed';
    }>;

type ExpectedOutputPreparationMutationPort = {
  prepareClaimedOutput(
    request: OutputPreparationMutationRequest,
  ): Promise<OutputPreparationPlatformResult>;
};

export type OutputPreparationResultIsExact = Expect<
  Equal<OutputPreparationResult, ExpectedOutputPreparationResult>
>;

export type OutputPreparationQuiescenceIsExact = Expect<
  Equal<OutputPreparationQuiescence, ExpectedOutputPreparationQuiescence>
>;

export type OutputPreparationAttemptIsExact = Expect<
  Equal<OutputPreparationAttempt, ExpectedOutputPreparationAttempt>
>;

export type ConsumedOutputPreparationMaterialVisibleFieldsAreExact = Expect<
  Equal<keyof ConsumedOutputPreparationMaterial, keyof ExpectedConsumedOutputPreparationMaterial>
>;

export type ConsumedRedactionMaterialVisibleFieldsAreExact = Expect<
  Equal<keyof ConsumedRedactionMaterial, 'invocationId'>
>;

export type PreparedInvocationVisibleFieldsAreExact = Expect<
  Equal<
    keyof PreparedInvocation,
    | 'invocationId'
    | 'pin'
    | 'workspaceDirectory'
    | 'outputDirectory'
    | 'reportedVersion'
    | 'binding'
  >
>;

export type PreparedInvocationBindingIsExact = Expect<
  Equal<PreparedInvocation['binding'], ExecutionBinding>
>;

export type PreparedInvocationMaterialIsExact = Expect<
  Equal<PreparedInvocationMaterial, ExpectedPreparedInvocationMaterial>
>;

export type ExecutionBindingIsExact = Expect<Equal<ExecutionBinding, ExpectedExecutionBinding>>;

export type OutputPreparationFileSlotIsExact = Expect<
  Equal<OutputPreparationFileSlot, ExpectedOutputPreparationFileSlot>
>;

export type PreparedExecutionSecurityVisibleFieldsAreExact = Expect<
  Equal<keyof PreparedExecutionSecurity, 'invocationId'>
>;

export type PreparedExecutionSecurityRequestIsExact = Expect<
  Equal<PreparedExecutionSecurityRequest, ExpectedPreparedExecutionSecurityRequest>
>;

export type TerminalPublicationAuthorityIsExact = Expect<
  Equal<TerminalPublicationAuthority, TerminalPublicationAuthority>
>;

export type PreparedInvocationResourcesIsExact = Expect<
  Equal<PreparedInvocationResources, PreparedInvocationResources>
>;

export type OutputPreparationMutationRequestIsExact = Expect<
  Equal<OutputPreparationMutationRequest, ExpectedOutputPreparationMutationRequest>
>;

export type OutputPreparationMutationPortIsExact = Expect<
  Equal<OutputPreparationMutationPort, ExpectedOutputPreparationMutationPort>
>;

export type OutputPreparationPlatformResultIsExact = Expect<
  Equal<OutputPreparationPlatformResult, ExpectedOutputPreparationPlatformResult>
>;

type ExpectedInvocationExecutionPorts = {
  readonly execution: {
    start(
      snapshot: InvocationInputSnapshot,
      preparedLaunch: PreparedLaunch,
    ): Promise<{
      readonly completion: Promise<InvocationTerminalObservation>;
      requestCancellation(): Promise<void>;
    }>;
  };
  readonly workspace: {
    admit(path: string): Promise<WorkspaceAdmissionResult>;
  };
  readonly clock: {
    now(): number;
    schedule(delayMs: number, callback: () => void): () => void;
  };
  readonly outputClaim: OutputClaimExclusiveCreatePort;
  readonly output: {
    admit(
      request: Readonly<{
        invocationId: string;
        outputDirectory: string;
        needsPromptFile: boolean;
        needsResultSchemaFile: boolean;
      }>,
    ): Promise<
      | Readonly<{
          status: 'admitted';
          plan: Readonly<{
            invocationId: string;
            outputDirectory: string;
            needsPromptFile: boolean;
            needsResultSchemaFile: boolean;
          }>;
        }>
      | Readonly<{
          status: 'rejected';
          reason:
            | 'unsupported_platform'
            | 'invalid_path'
            | 'missing_parent'
            | 'parent_not_directory'
            | 'leaf_exists'
            | 'inspection_failed';
        }>
    >;
    prepare(): Promise<void>;
    recordTerminalResult(outcome: NormalizedInvocationOutcome): Promise<void>;
    recordEvent(): Promise<void>;
  };
};

export type InvocationExecutionPortsIsExact = Expect<
  Equal<InvocationExecutionPorts, ExpectedInvocationExecutionPorts>
>;

type ExpectedRawResponseDiagnostic = {
  readonly byteLength: number;
  readonly truncated: boolean;
};

type ExpectedNormalizedInvocationOutcome =
  | { readonly status: 'succeeded'; readonly value: JsonObject }
  | {
      readonly status: 'failed';
      readonly reason:
        | 'execution_failed'
        | 'response_missing'
        | 'response_empty'
        | 'response_too_large'
        | 'response_invalid_utf8'
        | 'response_invalid_json'
        | 'response_json_primitive'
        | 'response_json_array'
        | 'response_schema_mismatch'
        | 'response_schema_validation_failed'
        | 'output_write_failed';
      readonly diagnostics?: AgentValidationDetails;
      readonly rawResponse?: ExpectedRawResponseDiagnostic;
    }
  | { readonly status: 'cancelled' }
  | { readonly status: 'timed_out' };

export type NormalizedInvocationOutcomeIsExact = Expect<
  Equal<NormalizedInvocationOutcome, ExpectedNormalizedInvocationOutcome>
>;
