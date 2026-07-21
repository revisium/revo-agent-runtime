import type {
  CompiledConsumerSchema,
  ConsumerSchemaProfileValidation,
  compileConsumerSchema,
  validateConsumerSchemaProfile,
  normalizeValidationDiagnostics,
  ValidationDiagnosticInput,
} from '../../src/runtime/definition/index.js';
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
