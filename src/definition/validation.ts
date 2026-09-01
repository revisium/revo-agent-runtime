import type { AgentDefinition, AgentDefinitionInput } from '../contracts/agent-definition.js';
import { DefinitionValidationError } from './errors.js';
import { validatesDefaults } from './schema-profile.js';
import { probeArgumentByteLimit } from './schema.js';

const textEncoder = new TextEncoder();

export const invalidDefinition = (): never => {
  throw new DefinitionValidationError('definition_invalid');
};

const unsupportedStrategy = (): never => {
  throw new DefinitionValidationError('strategy_unsupported');
};

const normalizeProtocol = (
  protocol: AgentDefinitionInput['protocol'],
): AgentDefinition['protocol'] => {
  if (protocol.driver !== 'native/stdio-v1' && protocol.driver !== 'acp/v1')
    return unsupportedStrategy();
  if (
    protocol.resultParser !== undefined &&
    protocol.resultParser !== 'codex-jsonl/v1' &&
    protocol.resultParser !== 'claude-stream-json/v1'
  )
    return unsupportedStrategy();
  if (
    protocol.permissionStrategy !== 'codex-cli/v1' &&
    protocol.permissionStrategy !== 'claude-cli/v1' &&
    protocol.permissionStrategy !== 'acp/v1'
  )
    return unsupportedStrategy();

  return {
    driver: protocol.driver,
    ...(protocol.resultParser === undefined ? {} : { resultParser: protocol.resultParser }),
    permissionStrategy: protocol.permissionStrategy,
  };
};

const assertStrategyCoherence = (definition: AgentDefinition): void => {
  const { delivery, protocol } = definition;
  if (protocol.driver === 'acp/v1') {
    if (
      protocol.resultParser !== undefined ||
      protocol.permissionStrategy !== 'acp/v1' ||
      delivery.prompt !== 'protocol' ||
      delivery.resultSchema !== 'protocol' ||
      delivery.result !== 'protocol'
    )
      return unsupportedStrategy();
    return;
  }

  const knownNativePair =
    (protocol.resultParser === 'codex-jsonl/v1' &&
      protocol.permissionStrategy === 'codex-cli/v1') ||
    (protocol.resultParser === 'claude-stream-json/v1' &&
      protocol.permissionStrategy === 'claude-cli/v1');
  if (
    !knownNativePair ||
    delivery.prompt === 'protocol' ||
    delivery.resultSchema === 'protocol' ||
    delivery.result !== 'stdout'
  )
    return unsupportedStrategy();
};

const argumentCount = (definition: AgentDefinition, kind: string): number =>
  definition.launch.args.filter((argument) => argument.kind === kind).length;

const assertDeliveryTemplates = (definition: AgentDefinition): void => {
  const prompt = argumentCount(definition, 'prompt');
  const promptFile = argumentCount(definition, 'prompt-file');
  const resultSchema = argumentCount(definition, 'result-schema');
  const resultSchemaFile = argumentCount(definition, 'result-schema-file');
  const validPrompt =
    (definition.delivery.prompt === 'argument' && prompt === 1 && promptFile === 0) ||
    (definition.delivery.prompt === 'file' && prompt === 0 && promptFile === 1) ||
    ((definition.delivery.prompt === 'stdin' || definition.delivery.prompt === 'protocol') &&
      prompt === 0 &&
      promptFile === 0);
  const validResultSchema =
    (definition.delivery.resultSchema === 'argument' &&
      resultSchema === 1 &&
      resultSchemaFile === 0) ||
    (definition.delivery.resultSchema === 'file' && resultSchema === 0 && resultSchemaFile === 1) ||
    (definition.delivery.resultSchema === 'protocol' &&
      resultSchema === 0 &&
      resultSchemaFile === 0);
  if (!validPrompt || !validResultSchema) return invalidDefinition();
};

const assertInputSchemas = (definition: AgentDefinition): void => {
  if (!validatesDefaults(definition.parameters.schema, definition.parameters.defaults))
    return invalidDefinition();
  if (!validatesDefaults(definition.permissions.schema, definition.permissions.defaults))
    return invalidDefinition();
};

const assertProbeArguments = (definition: AgentDefinition): void => {
  const { command, versionProbe } = definition.launch;
  const probeBytes =
    textEncoder.encode(command).byteLength +
    versionProbe.args.reduce(
      (total, argument) => total + textEncoder.encode(argument).byteLength,
      0,
    );
  if (probeBytes > probeArgumentByteLimit) return invalidDefinition();
};

export const validateDefinitionSemantics = (input: AgentDefinitionInput): AgentDefinition => {
  const definition = { ...input, protocol: normalizeProtocol(input.protocol) };
  assertStrategyCoherence(definition);
  assertDeliveryTemplates(definition);
  assertInputSchemas(definition);
  assertProbeArguments(definition);
  return definition;
};
