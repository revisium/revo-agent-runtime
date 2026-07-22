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
  parseVersionOutput,
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
