import { z } from 'zod/v4';

import { AgentManagerError } from '../../errors/index.js';
import {
  AGENT_FAULT_MESSAGES,
  AGENT_MANAGER_LIMITS,
  AGENT_RUNTIME_LIMITS,
} from '../../policy/index.js';
import type {
  AgentDefinitionContract,
  AgentFault,
  AgentManagerLimits,
  AgentValidationDetails,
  JsonObject,
  JsonSchema202012,
  JsonValue,
} from '../../spec/index.js';
import {
  parseAndClassifyAgentDefinition,
  rawAgentDefinitionSchema,
} from '../agent-definition-schema/index.js';
import { validateConsumerSchemaProfile } from '../consumer-schema-profile/index.js';
import {
  compileConsumerSchema,
  type CompiledConsumerSchema,
} from '../consumer-schema-validator/index.js';
import { createDefinitionIdentity } from '../definition-digest/index.js';
import { parseExecutableVersionConstraint } from '../executable-version-constraint/index.js';
import { inspectPlainJson } from '../plain-json/index.js';
import { canonicalizeJsonBytes } from '../rfc8785/index.js';
import {
  normalizeValidationDiagnostics,
  type ValidationDiagnosticInput,
} from '../validation-diagnostics/index.js';
import type { ValidatedDefinition } from './validated-definition.js';
import type { ValidatedManagerConstruction } from './validated-manager-construction.js';

const encoder = new TextEncoder();

const diagnosticMessages = Object.freeze({
  definition_bytes: 'Definition canonical UTF-8 representation exceeds 1 MiB.',
  definition_coherence: 'Agent definition fields are not coherent.',
  executable_version_constraint: 'Executable-version constraint is invalid.',
  limit_relation: 'Agent manager limits are not coherent.',
  limit_shape: 'Value does not satisfy the agent manager limits.',
  manager_options_shape: 'Value does not satisfy the agent manager options DTO.',
  probe_argv_bytes: 'Version-probe command and arguments exceed 1 MiB.',
  redaction_bytes: 'Redaction secrets exceed the configured bound.',
  redaction_shape: 'Value does not satisfy the redaction options.',
});

type DiagnosticKeyword = keyof typeof diagnosticMessages;

interface IndexedDefinition {
  readonly definition: AgentDefinitionContract;
  readonly index: number;
  readonly raw: JsonObject;
}

const boundedInteger = (minimum: number, maximum: number) =>
  z.number().finite().int().min(minimum).max(maximum);

const limitsSchema = z.strictObject({
  wallClockTimeoutMs: boundedInteger(
    AGENT_MANAGER_LIMITS.wallClockTimeoutMs.minimum,
    AGENT_MANAGER_LIMITS.wallClockTimeoutMs.maximum,
  ).exactOptional(),
  idleTimeoutMs: boundedInteger(
    AGENT_MANAGER_LIMITS.idleTimeoutMs.minimum,
    AGENT_MANAGER_LIMITS.idleTimeoutMs.maximum,
  ).exactOptional(),
  maxEventBytes: boundedInteger(
    AGENT_MANAGER_LIMITS.maxEventBytes.minimum,
    AGENT_MANAGER_LIMITS.maxEventBytes.maximum,
  ).exactOptional(),
  maxEventsFileBytes: z.number().finite().int().exactOptional(),
  maxStdoutBytes: boundedInteger(
    AGENT_MANAGER_LIMITS.maxStdoutBytes.minimum,
    AGENT_MANAGER_LIMITS.maxStdoutBytes.maximum,
  ).exactOptional(),
  maxStderrBytes: boundedInteger(
    AGENT_MANAGER_LIMITS.maxStderrBytes.minimum,
    AGENT_MANAGER_LIMITS.maxStderrBytes.maximum,
  ).exactOptional(),
  maxRawResponseBytes: boundedInteger(
    AGENT_MANAGER_LIMITS.maxRawResponseBytes.minimum,
    AGENT_MANAGER_LIMITS.maxRawResponseBytes.maximum,
  ).exactOptional(),
  maxCompletedInvocations: boundedInteger(
    AGENT_MANAGER_LIMITS.maxCompletedInvocations.minimum,
    AGENT_MANAGER_LIMITS.maxCompletedInvocations.maximum,
  ).exactOptional(),
});

const managerOptionsSchema = z.strictObject({
  definitions: z.array(z.unknown()).max(AGENT_RUNTIME_LIMITS.definitions),
  limits: limitsSchema.exactOptional(),
  redaction: z
    .strictObject({ secrets: z.array(z.string()).max(AGENT_RUNTIME_LIMITS.redactionValues) })
    .exactOptional(),
});

const createFault = (
  code: AgentFault['code'],
  message: string,
  details?: AgentValidationDetails | JsonObject,
): AgentFault =>
  Object.freeze({
    code,
    message,
    phase: 'construction',
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });

const internalFailure = (): never => {
  throw new AgentManagerError(
    createFault('revo.agent.internal', AGENT_FAULT_MESSAGES.internalConstruction),
  );
};

const reject = (
  code: AgentFault['code'],
  message: string,
  details?: AgentValidationDetails,
): never => {
  throw new AgentManagerError(createFault(code, message, details));
};

const rejectDiagnostic = (
  code: AgentFault['code'],
  keyword: DiagnosticKeyword,
  instancePath: string,
): never =>
  reject(
    code,
    code === 'revo.agent.limit_invalid'
      ? AGENT_FAULT_MESSAGES.limitInvalid
      : AGENT_FAULT_MESSAGES.definitionInvalid,
    normalizeValidationDiagnostics([
      {
        instancePath,
        schemaPath: `/${keyword}`,
        keyword,
        message: diagnosticMessages[keyword],
      },
    ]),
  );

const appendPointerToken = (base: string, token: string): string =>
  `${base}/${token.replaceAll('~', '~0').replaceAll('/', '~1')}`;

const zodIssuePath = (path: readonly PropertyKey[]): string => {
  let pointer = '';
  for (const token of path) {
    if (typeof token === 'string' || typeof token === 'number')
      pointer = appendPointerToken(pointer, String(token));
  }
  return pointer;
};

const parseStrictManagerOptions = (value: unknown) => {
  const parsed = managerOptionsSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];
  if (issue === undefined) return internalFailure();
  const pointer = zodIssuePath(issue.path);
  if (issue.path[0] === 'limits')
    return rejectDiagnostic('revo.agent.limit_invalid', 'limit_shape', pointer || '/limits');
  if (issue.path[0] === 'redaction')
    return rejectDiagnostic(
      'revo.agent.definition_invalid',
      'redaction_shape',
      pointer || '/redaction',
    );
  return rejectDiagnostic(
    'revo.agent.definition_invalid',
    'manager_options_shape',
    issue.path[0] === 'definitions' ? '/definitions' : '/',
  );
};

const isAgentValidationDetails = (value: unknown): value is AgentValidationDetails =>
  value !== null &&
  typeof value === 'object' &&
  Array.isArray(Reflect.get(value, 'diagnostics')) &&
  typeof Reflect.get(value, 'truncated') === 'boolean';

const remapPreflightPath = (path: string): string =>
  path === '/definitions' ||
  path.startsWith('/definitions/') ||
  path === '/limits' ||
  path.startsWith('/limits/') ||
  path === '/redaction' ||
  path.startsWith('/redaction/')
    ? path
    : '/';

const inspectManagerOptionsGraph = (value: unknown): unknown => {
  try {
    inspectPlainJson(value, '');
    return value;
  } catch (error: unknown) {
    if (!(error instanceof AgentManagerError) || !isAgentValidationDetails(error.fault.details))
      throw error;

    const inputs: ValidationDiagnosticInput[] = [];
    for (const diagnostic of error.fault.details.diagnostics) {
      inputs.push({
        instancePath: remapPreflightPath(diagnostic.instancePath),
        schemaPath: diagnostic.schemaPath,
        keyword: diagnostic.keyword,
        message: diagnostic.message,
      });
    }
    if (inputs.length === 0) return internalFailure();
    const details = normalizeValidationDiagnostics(inputs);
    const limitsOnly = details.diagnostics.every(
      (diagnostic) =>
        diagnostic.instancePath === '/limits' || diagnostic.instancePath.startsWith('/limits/'),
    );
    return reject(
      limitsOnly ? 'revo.agent.limit_invalid' : 'revo.agent.definition_invalid',
      limitsOnly ? AGENT_FAULT_MESSAGES.limitInvalid : error.fault.message,
      details,
    );
  }
};

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value).every(isJsonValue);
  return false;
};

const isJsonObject = (value: unknown): value is JsonObject =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every(isJsonValue);

const asJsonObject = (value: unknown): JsonObject => {
  if (isJsonObject(value)) return value;
  return internalFailure();
};

const getCompiledConsumerSchema = (
  schema: JsonSchema202012,
  schemaPath: string,
  compiledSchemas: Map<string, CompiledConsumerSchema>,
): CompiledConsumerSchema => {
  const key = JSON.stringify(schema);
  if (key === undefined) return internalFailure();

  const cached = compiledSchemas.get(key);
  if (cached !== undefined) return cached;

  const compiled = compileConsumerSchema(schema, schemaPath);
  compiledSchemas.set(key, compiled);
  return compiled;
};

const validateSchemaAndDefaults = (
  schema: unknown,
  defaults: JsonValue | undefined,
  schemaPath: string,
  defaultsPath: string,
  compiledSchemas: Map<string, CompiledConsumerSchema>,
): void => {
  const profile = validateConsumerSchemaProfile(schema, schemaPath);
  if (!profile.valid)
    return reject(
      'revo.agent.definition_invalid',
      AGENT_FAULT_MESSAGES.definitionInvalid,
      profile.diagnostics,
    );

  if (defaults === undefined) return;
  const details = getCompiledConsumerSchema(profile.schema, schemaPath, compiledSchemas).validate(
    defaults,
    defaultsPath,
  );
  if (details !== undefined)
    reject('revo.agent.definition_invalid', AGENT_FAULT_MESSAGES.definitionInvalid, details);
};

const countTemplate = (definition: AgentDefinitionContract, kind: string): number =>
  definition.launch.args.filter((argument) => argument.kind === kind).length;

const assertTemplateCoherence = (definition: AgentDefinitionContract, index: number): void => {
  const prompt = countTemplate(definition, 'prompt');
  const promptFile = countTemplate(definition, 'prompt-file');
  const resultSchema = countTemplate(definition, 'result-schema');
  const resultSchemaFile = countTemplate(definition, 'result-schema-file');
  const invalidPrompt =
    (definition.delivery.prompt === 'argument' && (prompt !== 1 || promptFile !== 0)) ||
    (definition.delivery.prompt === 'file' && (prompt !== 0 || promptFile !== 1)) ||
    ((definition.delivery.prompt === 'stdin' || definition.delivery.prompt === 'protocol') &&
      (prompt !== 0 || promptFile !== 0));
  const invalidResultSchema =
    (definition.delivery.resultSchema === 'argument' &&
      (resultSchema !== 1 || resultSchemaFile !== 0)) ||
    (definition.delivery.resultSchema === 'file' &&
      (resultSchema !== 0 || resultSchemaFile !== 1)) ||
    (definition.delivery.resultSchema === 'protocol' &&
      (resultSchema !== 0 || resultSchemaFile !== 0));

  if (invalidPrompt || invalidResultSchema)
    rejectDiagnostic(
      'revo.agent.definition_invalid',
      'definition_coherence',
      `/definitions/${index}/launch/args`,
    );
};

const rejectCoherence = (index: number, path: string): never =>
  rejectDiagnostic(
    'revo.agent.definition_invalid',
    'definition_coherence',
    `/definitions/${index}${path}`,
  );

const assertStrategyCoherence = (definition: AgentDefinitionContract, index: number): void => {
  const { delivery, protocol } = definition;
  if (protocol.driver === 'native/stdio-v1') {
    if (protocol.resultParser === undefined) rejectCoherence(index, '/protocol/resultParser');
    if (delivery.prompt === 'protocol') rejectCoherence(index, '/delivery/prompt');
    if (delivery.resultSchema === 'protocol') rejectCoherence(index, '/delivery/resultSchema');
    if (delivery.result !== 'stdout') rejectCoherence(index, '/delivery/result');
    const coherentPermission =
      (protocol.resultParser === 'codex-jsonl/v1' &&
        protocol.permissionStrategy === 'codex-cli/v1') ||
      (protocol.resultParser === 'claude-stream-json/v1' &&
        protocol.permissionStrategy === 'claude-cli/v1');
    if (!coherentPermission) rejectCoherence(index, '/protocol/permissionStrategy');
    return;
  }

  if (protocol.resultParser !== undefined) rejectCoherence(index, '/protocol/resultParser');
  if (delivery.prompt !== 'protocol') rejectCoherence(index, '/delivery/prompt');
  if (delivery.resultSchema !== 'protocol') rejectCoherence(index, '/delivery/resultSchema');
  if (delivery.result !== 'protocol') rejectCoherence(index, '/delivery/result');
  if (protocol.permissionStrategy !== 'acp/v1')
    rejectCoherence(index, '/protocol/permissionStrategy');
};

const assertProbeAndConstraint = (definition: AgentDefinitionContract, index: number): void => {
  const probe = definition.launch.versionProbe;
  if (probe !== undefined) {
    const bytes =
      encoder.encode(definition.launch.command).byteLength +
      probe.args.reduce((total, argument) => total + encoder.encode(argument).byteLength, 0);
    if (bytes > AGENT_RUNTIME_LIMITS.argvBytes)
      rejectDiagnostic(
        'revo.agent.definition_invalid',
        'probe_argv_bytes',
        `/definitions/${index}/launch/versionProbe/args`,
      );
  }

  const constraint = definition.constraints?.executableVersion;
  if (
    constraint !== undefined &&
    (probe === undefined || parseExecutableVersionConstraint(constraint) === undefined)
  )
    rejectDiagnostic(
      'revo.agent.definition_invalid',
      'executable_version_constraint',
      `/definitions/${index}/constraints/executableVersion`,
    );
};

const validateOneDefinition = (
  raw: unknown,
  index: number,
  compiledSchemas: Map<string, CompiledConsumerSchema>,
): IndexedDefinition => {
  const definition = parseAndClassifyAgentDefinition(raw, index);
  const json = asJsonObject(raw);
  if (canonicalizeJsonBytes(json).byteLength > AGENT_RUNTIME_LIMITS.definitionBytes)
    rejectDiagnostic('revo.agent.definition_invalid', 'definition_bytes', `/definitions/${index}`);
  validateSchemaAndDefaults(
    definition.parameters.schema,
    definition.parameters.defaults,
    `/definitions/${index}/parameters/schema`,
    `/definitions/${index}/parameters/defaults`,
    compiledSchemas,
  );
  validateSchemaAndDefaults(
    definition.permissions.schema,
    definition.permissions.defaults,
    `/definitions/${index}/permissions/schema`,
    `/definitions/${index}/permissions/defaults`,
    compiledSchemas,
  );
  assertStrategyCoherence(definition, index);
  assertTemplateCoherence(definition, index);
  assertProbeAndConstraint(definition, index);
  return { definition, index, raw: json };
};

const assertUniqueExactRefs = (definitions: readonly IndexedDefinition[]): void => {
  const seen = new Map<string, Map<string, number>>();
  for (const { definition, index } of definitions) {
    const versions = seen.get(definition.id);
    const firstIndex = versions?.get(definition.version);
    if (firstIndex !== undefined)
      throw new AgentManagerError(
        createFault('revo.agent.definition_duplicate', AGENT_FAULT_MESSAGES.definitionDuplicate, {
          agent: { id: definition.id, version: definition.version },
          firstIndex,
          duplicateIndex: index,
        }),
      );
    if (versions === undefined) seen.set(definition.id, new Map([[definition.version, index]]));
    else versions.set(definition.version, index);
  }
};

const effectiveLimits = (limits: z.infer<typeof limitsSchema> | undefined): AgentManagerLimits => {
  const result: AgentManagerLimits = {
    wallClockTimeoutMs:
      limits?.wallClockTimeoutMs ?? AGENT_MANAGER_LIMITS.wallClockTimeoutMs.default,
    idleTimeoutMs: limits?.idleTimeoutMs ?? AGENT_MANAGER_LIMITS.idleTimeoutMs.default,
    maxEventBytes: limits?.maxEventBytes ?? AGENT_MANAGER_LIMITS.maxEventBytes.default,
    maxEventsFileBytes:
      limits?.maxEventsFileBytes ?? AGENT_MANAGER_LIMITS.maxEventsFileBytes.default,
    maxStdoutBytes: limits?.maxStdoutBytes ?? AGENT_MANAGER_LIMITS.maxStdoutBytes.default,
    maxStderrBytes: limits?.maxStderrBytes ?? AGENT_MANAGER_LIMITS.maxStderrBytes.default,
    maxRawResponseBytes:
      limits?.maxRawResponseBytes ?? AGENT_MANAGER_LIMITS.maxRawResponseBytes.default,
    maxCompletedInvocations:
      limits?.maxCompletedInvocations ?? AGENT_MANAGER_LIMITS.maxCompletedInvocations.default,
  };
  if (result.idleTimeoutMs! > result.wallClockTimeoutMs!)
    rejectDiagnostic('revo.agent.limit_invalid', 'limit_relation', '/limits/idleTimeoutMs');
  const terminalReservation =
    AGENT_MANAGER_LIMITS.maxTerminalEventBytes + result.maxEventBytes! + 2;
  if (
    result.maxEventsFileBytes! < terminalReservation ||
    result.maxEventsFileBytes! > AGENT_MANAGER_LIMITS.maxEventsFileBytes.maximum
  )
    rejectDiagnostic('revo.agent.limit_invalid', 'limit_relation', '/limits/maxEventsFileBytes');
  return Object.freeze(result);
};

const effectiveRedaction = (redaction: z.infer<typeof managerOptionsSchema>['redaction']) => {
  const secrets = redaction?.secrets ?? [];
  const bytes = secrets.reduce((total, secret) => total + encoder.encode(secret).byteLength, 0);
  if (bytes > AGENT_RUNTIME_LIMITS.redactionTotalBytes)
    rejectDiagnostic('revo.agent.definition_invalid', 'redaction_bytes', '/redaction/secrets');
  return Object.freeze({ secrets: Object.freeze([...secrets]) });
};

function assertAgentDefinitionSnapshot(
  snapshot: JsonObject,
  index: number,
): asserts snapshot is JsonObject & AgentDefinitionContract {
  if (!rawAgentDefinitionSchema.safeParse(snapshot).success) internalFailure();
  try {
    parseAndClassifyAgentDefinition(snapshot, index);
  } catch {
    internalFailure();
  }
}

const createValidatedDefinition = ({ raw, index }: IndexedDefinition): ValidatedDefinition => {
  const identity = createDefinitionIdentity(raw);
  assertAgentDefinitionSnapshot(identity.snapshot, index);
  return Object.freeze({ definition: identity.snapshot, definitionDigest: identity.digest });
};

const freezeValidatedConstruction = (
  options: z.infer<typeof managerOptionsSchema>,
  definitions: readonly IndexedDefinition[],
): ValidatedManagerConstruction => {
  const limits = effectiveLimits(options.limits);
  const redaction = effectiveRedaction(options.redaction);
  const validatedDefinitions = Object.freeze(definitions.map(createValidatedDefinition));

  return Object.freeze({ definitions: validatedDefinitions, limits, redaction });
};

export const validateManagerOptions = (value: unknown): ValidatedManagerConstruction => {
  const plain = inspectManagerOptionsGraph(value);
  const options = parseStrictManagerOptions(plain);
  const compiledSchemas = new Map<string, CompiledConsumerSchema>();
  const definitions = options.definitions.map((definition, index) =>
    validateOneDefinition(definition, index, compiledSchemas),
  );
  assertUniqueExactRefs(definitions);
  return freezeValidatedConstruction(options, definitions);
};
