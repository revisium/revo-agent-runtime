import { AgentManagerError } from '../../errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../policy/index.js';
import type {
  AgentDefinitionContract,
  AgentDefinitionInput,
  AgentFault,
} from '../../spec/index.js';
import { inspectPlainJson } from '../plain-json/index.js';
import { rawAgentDefinitionSchema } from './raw-agent-definition-schema.js';

const DRIVER_IDENTIFIERS = Object.freeze(['native/stdio-v1', 'acp/v1'] as const);
const RESULT_PARSER_IDENTIFIERS = Object.freeze([
  'codex-jsonl/v1',
  'claude-stream-json/v1',
] as const);
const PERMISSION_STRATEGY_IDENTIFIERS = Object.freeze([
  'codex-cli/v1',
  'claude-cli/v1',
  'acp/v1',
] as const);

const definitionInvalidFault = (): AgentFault =>
  Object.freeze({
    code: 'revo.agent.definition_invalid',
    message: AGENT_FAULT_MESSAGES.definitionInvalid,
    phase: 'construction',
    retryable: false,
  });

const strategyUnsupportedFault = (): AgentFault =>
  Object.freeze({
    code: 'revo.agent.strategy_unsupported',
    message: AGENT_FAULT_MESSAGES.strategyUnsupported,
    phase: 'construction',
    retryable: false,
  });

const isKnownDriver = (value: string): value is AgentDefinitionContract['protocol']['driver'] =>
  DRIVER_IDENTIFIERS.some((identifier) => identifier === value);

const isKnownResultParser = (
  value: string,
): value is NonNullable<AgentDefinitionContract['protocol']['resultParser']> =>
  RESULT_PARSER_IDENTIFIERS.some((identifier) => identifier === value);

const isKnownPermissionStrategy = (
  value: string,
): value is AgentDefinitionContract['protocol']['permissionStrategy'] =>
  PERMISSION_STRATEGY_IDENTIFIERS.some((identifier) => identifier === value);

const classifyProtocol = (
  protocol: AgentDefinitionInput['protocol'],
): AgentDefinitionContract['protocol'] => {
  if (!isKnownDriver(protocol.driver)) throw new AgentManagerError(strategyUnsupportedFault());
  if (protocol.resultParser !== undefined && !isKnownResultParser(protocol.resultParser))
    throw new AgentManagerError(strategyUnsupportedFault());
  if (!isKnownPermissionStrategy(protocol.permissionStrategy))
    throw new AgentManagerError(strategyUnsupportedFault());

  return {
    driver: protocol.driver,
    ...(protocol.resultParser === undefined ? {} : { resultParser: protocol.resultParser }),
    permissionStrategy: protocol.permissionStrategy,
  };
};

const narrowAgentDefinition = (definition: AgentDefinitionInput): AgentDefinitionContract => ({
  ...definition,
  protocol: classifyProtocol(definition.protocol),
});

export const parseAndClassifyAgentDefinition = (
  value: unknown,
  index: number,
): AgentDefinitionContract => {
  inspectPlainJson(value, `/definitions/${index}`);

  const parsed = rawAgentDefinitionSchema.safeParse(value);
  if (!parsed.success) throw new AgentManagerError(definitionInvalidFault());

  return narrowAgentDefinition(parsed.data);
};
