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
  OutputPreparationFileAttestation,
  ExecutionBinding,
  beginOutputClaim,
  createRedactingBoundedOutputSink,
  createRedactionChannel,
  wrapRedactionChannelAsBoundedOutputSink,
  createOutputClaimAttempt,
  ClaimedInvocationOutput,
  inspectOutputClaimGuard,
  InvocationExecutionPorts,
  InvocationInputSnapshot,
  InvocationTerminalObservation,
  InvocationTokenCarrier,
  LiveOwnedProcess,
  BoundedRawResponseEvidence,
  NormalizedInvocationFailure,
  NormalizedInvocationEvidence,
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
  takePreparedInvocationResourcesPayload,
  PreparedExecutionSecurity,
  PreparedExecutionSecurityRequest,
  PreparedLaunch,
  ParserFailureReason,
  AttachedProtocolSession,
  DuplexCoordinatorRegistration,
  PausedProcessIo,
  PreparedProtocolSession,
  ProcessIdentityInspectionResult,
  ProcessInputSink,
  ProcessIoActivationResult,
  ProcessStartAttempt,
  ProcessStartQuiescence,
  ProcessStartResult,
  RetainedCleanupAuthority,
  beginProcessStart,
  createProcessStartAttempt,
  getProcessStartInvocationToken,
  settleProcessStart,
  settleProcessStartQuiescence,
  ProcessExitObservation,
  ProcessIdentity,
  ProcessOutputSink,
  EventsAppendSink,
  OutputAppendResult,
  TerminalResultPublicationResult,
  RawFinalResponseEligibility,
  RawResponsePublicationResult,
  ScratchCleanupResult,
  TerminalPublicationPort,
  ProcessSpawnRequest,
  ProtocolAttachResult,
  ProtocolDriverCreateRequest,
  ProtocolDriverId,
  ProtocolDriverPort,
  ProtocolObservationResult,
  RedactingBoundedOutputSink,
  RedactingOutputGuardRequest,
  RedactionChannel,
  ResultParserPort,
  ResultParserUsage,
  RegisteredSecrets,
  registerSecrets,
  revealRegisteredSecrets,
  SealedSecretRegistration,
  SecretRegistrationRequest,
  SpawnAcceptedProcess,
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
  AgentExecutionPin,
  AgentEvent,
  AgentInvocationResult,
  AgentInvocationSucceeded,
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
  | 'revo.agent.protocol_failed'
  | 'revo.agent.output_write_failed'
  | 'revo.agent.process_failed'
  | 'revo.agent.result_missing'
  | 'revo.agent.result_too_large'
  | 'revo.agent.result_invalid_json'
  | 'revo.agent.result_not_object'
  | 'revo.agent.result_schema_mismatch'
  | 'revo.agent.scratch_cleanup_failed'
  | 'revo.agent.cancelled'
  | 'revo.agent.timeout'
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

type ExpectedProcessSpawnRequest = {
  readonly invocationId: string;
  readonly cwd: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly stdin: 'pipe';
  readonly stdout: ProcessOutputSink;
  readonly stderr: ProcessOutputSink;
};

type ExpectedProcessIdentity = {
  readonly pid: number;
  readonly processGroupId: number;
  readonly fingerprint: string;
};

type ExpectedLiveOwnedProcess = {
  readonly spawnedAt: number;
  readonly completion: Promise<ProcessExitObservation>;
  readonly identity: ProcessIdentity;
  readonly stdin: ProcessInputSink;
  terminateAndReap(): Promise<void>;
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

export type WrapRedactionChannelAsBoundedOutputSinkIsExact = Expect<
  Equal<
    typeof wrapRedactionChannelAsBoundedOutputSink,
    (request: {
      readonly channel: RedactionChannel;
      readonly downstream: ProcessOutputSink;
      readonly maxBytes: number;
    }) => RedactingBoundedOutputSink
  >
>;

export type ProcessSpawnRequestIsExact = Expect<
  Equal<ProcessSpawnRequest, ExpectedProcessSpawnRequest>
>;

export type ProcessIdentityIsExact = Expect<Equal<ProcessIdentity, ExpectedProcessIdentity>>;

export type LiveOwnedProcessIsExact = Expect<Equal<LiveOwnedProcess, ExpectedLiveOwnedProcess>>;

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
  AgentExecutionPin,
  AgentEvent,
  AgentInvocationResult,
  AgentInvocationSucceeded,
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
  | Readonly<{
      status: 'prepared';
      attestations: readonly OutputPreparationFileAttestation[];
      frontEnds: Readonly<{
        stdout: RedactionChannel;
        stderr: RedactionChannel;
        rawResponse: RedactionChannel;
      }>;
      evidenceSinks: Readonly<{
        stdout: ProcessOutputSink;
        stderr: ProcessOutputSink;
      }>;
      eventsAppendSink: EventsAppendSink;
    }>
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

type ExpectedEventsAppendSink = {
  write(chunk: Uint8Array): Promise<void>;
  flush(): Promise<void>;
};

type ExpectedOutputAppendResult =
  | Readonly<{ status: 'appended' }>
  | Readonly<{ status: 'suppressed'; reason: 'nonterminal_budget_exhausted' }>
  | Readonly<{ status: 'failed'; reason: 'write_failed' | 'flush_failed' }>;

type ExpectedTerminalResultPublicationResult =
  | Readonly<{ status: 'published'; file: 'result.json' }>
  | Readonly<{
      status:
        | 'conflict'
        | 'write_failed'
        | 'flush_failed'
        | 'link_failed'
        | 'directory_flush_failed';
    }>;

type ExpectedRawResponsePublicationResult =
  | Readonly<{ status: 'published'; file: 'raw-final-response.txt' }>
  | Readonly<{
      status:
        | 'conflict'
        | 'write_failed'
        | 'flush_failed'
        | 'link_failed'
        | 'directory_flush_failed';
    }>;

type ExpectedScratchCleanupResult =
  | Readonly<{ status: 'cleaned' }>
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'failed'; reason: 'cleanup_failed' }>;

type ExpectedTerminalPublicationPort = {
  appendLifecycleEvent(
    authority: TerminalPublicationAuthority,
    event: AgentEvent,
  ): Promise<OutputAppendResult>;
  publishTerminalResult(
    authority: TerminalPublicationAuthority,
    result: AgentInvocationResult,
  ): Promise<TerminalResultPublicationResult>;
  publishRawResponse(
    authority: TerminalPublicationAuthority,
    eligibility: RawFinalResponseEligibility,
    bytes: Uint8Array,
  ): Promise<RawResponsePublicationResult>;
  cleanupScratch(authority: TerminalPublicationAuthority): Promise<ScratchCleanupResult>;
};

type ExpectedAgentExecutionPin = {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly definitionDigest: string;
};

type ExpectedProcessInputSink = {
  write(chunk: Uint8Array): Promise<void>;
  end(): Promise<void>;
  abort(): Promise<void>;
};

type ExpectedSpawnAcceptedProcess = {
  readonly invocationId: string;
  readonly spawnedAt: number;
};

type ExpectedInvocationOnlyCarrier = {
  readonly invocationId: string;
};

type ExpectedProcessIdentityInspectionResult =
  | Readonly<{ status: 'identified'; identity: ProcessIdentity }>
  | Readonly<{
      status: 'failed';
      reason: 'inspection_failed' | 'fingerprint_failed' | 'deadline';
    }>;

type ExpectedProcessIoActivationResult =
  | Readonly<{ status: 'activated'; process: LiveOwnedProcess }>
  | Readonly<{ status: 'rejected'; reason: 'internal_invariant_violation' }>;

type ExpectedRetainedCleanupAuthority = {
  readonly invocationId: string;
};

type ExpectedProcessStartResult =
  | Readonly<{ status: 'spawn_accepted'; process: SpawnAcceptedProcess; io: PausedProcessIo }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'cancelled_before_spawn'
        | 'manager_shutdown_before_spawn'
        | 'spawn_failed'
        | 'internal_invariant_violation';
    }>;

type ExpectedProcessStartQuiescence =
  | Readonly<{
      status: 'quiescent';
      disposition: 'not_spawned' | 'cleanup_confirmed' | 'transferred_to_coordinator';
    }>
  | Readonly<{ status: 'retained'; authority: RetainedCleanupAuthority }>;

type ExpectedProcessStartAttempt = {
  readonly invocationId: string;
  readonly settlement: Promise<ProcessStartResult>;
  readonly quiescence: Promise<ProcessStartQuiescence>;
  requestCancellation(reason: 'caller_cancel' | 'manager_shutdown'): void;
};

type ExpectedProtocolDriverId = AgentDefinitionContract['protocol']['driver'];

type ExpectedProtocolDriverCreateRequest = {
  readonly invocationId: string;
  readonly delivery: ExecutionBinding['delivery'];
  readonly cancellationSupported: boolean;
  readonly promptBytes?: Uint8Array;
  readonly canonicalResultSchemaBytes?: Uint8Array;
  readonly resultParser?: ResultParserPort;
};

type ExpectedPreparedProtocolSession = {
  readonly protocolOutput: ProcessOutputSink;
  attach(input: ProcessInputSink): Promise<ProtocolAttachResult>;
  dispose(): void;
};

type ExpectedProtocolAttachResult =
  | Readonly<{ status: 'attached'; session: AttachedProtocolSession }>
  | Readonly<{
      status: 'failed';
      reason: 'attach_failed' | 'stdin_write_failed' | 'stdin_end_failed';
    }>;

type ExpectedAttachedProtocolSession = {
  finishAfterProtocolOutputEnd(): Promise<ProtocolObservationResult>;
  requestCancellation(): Promise<'sent' | 'unsupported' | 'failed'>;
  closeInput(): Promise<void>;
  dispose(): void;
};

type ExpectedProtocolObservationResult =
  | Readonly<{
      status: 'completed';
      response: JsonObject;
      usage?: ResultParserUsage;
      rawResponse?: BoundedRawResponseEvidence;
    }>
  | Readonly<{
      status: 'failed';
      failure:
        | Readonly<{ kind: 'protocol_sink_failed' }>
        | Readonly<{ kind: 'parser_failed'; reason: ParserFailureReason }>;
      rawResponse?: BoundedRawResponseEvidence;
    }>;

type ExpectedProtocolDriverPort = {
  readonly id: ProtocolDriverId;
  create(request: ProtocolDriverCreateRequest): PreparedProtocolSession;
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

export type InvocationTokenCarrierVisibleFieldsAreExact = Expect<
  Equal<keyof InvocationTokenCarrier, 'invocationId'>
>;

export type EventsAppendSinkIsExact = Expect<Equal<EventsAppendSink, ExpectedEventsAppendSink>>;
export type OutputAppendResultIsExact = Expect<
  Equal<OutputAppendResult, ExpectedOutputAppendResult>
>;
export type TerminalResultPublicationResultIsExact = Expect<
  Equal<TerminalResultPublicationResult, ExpectedTerminalResultPublicationResult>
>;
export type RawResponsePublicationResultIsExact = Expect<
  Equal<RawResponsePublicationResult, ExpectedRawResponsePublicationResult>
>;
export type ScratchCleanupResultIsExact = Expect<
  Equal<ScratchCleanupResult, ExpectedScratchCleanupResult>
>;
export type TerminalPublicationPortIsExact = Expect<
  Equal<TerminalPublicationPort, ExpectedTerminalPublicationPort>
>;
export type AgentExecutionPinIsExact = Expect<Equal<AgentExecutionPin, ExpectedAgentExecutionPin>>;
export type AgentEventIsIncluded = Expect<Equal<AgentEvent, AgentEvent>>;
export type AgentInvocationSucceededIsIncluded = Expect<
  Equal<AgentInvocationSucceeded, AgentInvocationSucceeded>
>;

export type ProcessInputSinkIsExact = Expect<Equal<ProcessInputSink, ExpectedProcessInputSink>>;

export type ProcessSpawnRequestVisibleFieldsAreExact = Expect<
  Equal<keyof ProcessSpawnRequest, keyof ExpectedProcessSpawnRequest>
>;

export type SpawnAcceptedProcessVisibleFieldsAreExact = Expect<
  Equal<keyof SpawnAcceptedProcess, keyof ExpectedSpawnAcceptedProcess>
>;

export type PausedProcessIoVisibleFieldsAreExact = Expect<
  Equal<keyof PausedProcessIo, keyof ExpectedInvocationOnlyCarrier>
>;

export type DuplexCoordinatorRegistrationVisibleFieldsAreExact = Expect<
  Equal<keyof DuplexCoordinatorRegistration, keyof ExpectedInvocationOnlyCarrier>
>;

export type ProcessIdentityInspectionResultIsExact = Expect<
  Equal<ProcessIdentityInspectionResult, ExpectedProcessIdentityInspectionResult>
>;

export type ProcessIoActivationResultIsExact = Expect<
  Equal<ProcessIoActivationResult, ExpectedProcessIoActivationResult>
>;

export type RetainedCleanupAuthorityVisibleFieldsAreExact = Expect<
  Equal<keyof RetainedCleanupAuthority, keyof ExpectedRetainedCleanupAuthority>
>;

export type ProcessStartResultIsExact = Expect<
  Equal<ProcessStartResult, ExpectedProcessStartResult>
>;

export type ProcessStartQuiescenceIsExact = Expect<
  Equal<ProcessStartQuiescence, ExpectedProcessStartQuiescence>
>;

export type ProcessStartAttemptIsExact = Expect<
  Equal<ProcessStartAttempt, ExpectedProcessStartAttempt>
>;

export type CreateProcessStartAttemptIsExact = Expect<
  Equal<
    typeof createProcessStartAttempt,
    (input: { readonly invocationId: string }) => ProcessStartAttempt
  >
>;

export type SettleProcessStartQuiescenceIsExact = Expect<
  Equal<
    typeof settleProcessStartQuiescence,
    (attempt: object, quiescence: ProcessStartQuiescence) => void
  >
>;

export type BeginProcessStartIsExact = Expect<
  Equal<typeof beginProcessStart, (attempt: ProcessStartAttempt, dispatch: () => void) => void>
>;

export type SettleProcessStartIsExact = Expect<
  Equal<
    typeof settleProcessStart,
    (
      attempt: object,
      outcome: Readonly<{ status: 'accepted'; spawnedAt: number }> | Readonly<{ status: 'failed' }>,
    ) => ProcessStartResult | undefined
  >
>;

export type GetProcessStartInvocationTokenIsExact = Expect<
  Equal<typeof getProcessStartInvocationToken, (attempt: unknown) => object | undefined>
>;

export type ProtocolDriverIdIsExact = Expect<Equal<ProtocolDriverId, ExpectedProtocolDriverId>>;

export type ProtocolDriverCreateRequestIsExact = Expect<
  Equal<ProtocolDriverCreateRequest, ExpectedProtocolDriverCreateRequest>
>;

export type PreparedProtocolSessionIsExact = Expect<
  Equal<PreparedProtocolSession, ExpectedPreparedProtocolSession>
>;

export type ProtocolAttachResultIsExact = Expect<
  Equal<ProtocolAttachResult, ExpectedProtocolAttachResult>
>;

export type AttachedProtocolSessionIsExact = Expect<
  Equal<AttachedProtocolSession, ExpectedAttachedProtocolSession>
>;

export type ProtocolObservationResultIsExact = Expect<
  Equal<ProtocolObservationResult, ExpectedProtocolObservationResult>
>;

export type ProtocolDriverPortIsExact = Expect<
  Equal<ProtocolDriverPort, ExpectedProtocolDriverPort>
>;

type ExpectedInvocationExecutionPorts = {
  readonly execution: {
    start(
      snapshot: InvocationInputSnapshot,
      preparedLaunch: PreparedLaunch,
      resources?: NonNullable<ReturnType<typeof takePreparedInvocationResourcesPayload>>,
    ): Promise<{
      readonly spawnedAt: number;
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
  readonly outputPreparation: OutputPreparationMutationPort;
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
    recordTerminalResult(outcome: NormalizedInvocationOutcome): Promise<void>;
    recordEvent(): Promise<void>;
  };
};

export type InvocationExecutionPortsIsExact = Expect<
  Equal<InvocationExecutionPorts, ExpectedInvocationExecutionPorts>
>;

type ExpectedNormalizedInvocationOutcome =
  | Readonly<{
      readonly status: 'succeeded';
      readonly value: JsonObject;
      readonly evidence: NormalizedInvocationEvidence;
    }>
  | Readonly<{
      readonly status: 'failed';
      readonly failure: NormalizedInvocationFailure;
      readonly evidence: NormalizedInvocationEvidence;
    }>
  | Readonly<{
      readonly status: 'cancelled' | 'timed_out';
      readonly evidence: NormalizedInvocationEvidence;
    }>;

export type NormalizedInvocationOutcomeIsExact = Expect<
  Equal<NormalizedInvocationOutcome, ExpectedNormalizedInvocationOutcome>
>;
