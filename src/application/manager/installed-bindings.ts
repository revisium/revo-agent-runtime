import type { ValidatedDefinition } from '../../runtime/definition/index.js';
import { AgentManagerError } from '../../runtime/errors/index.js';
import { ExecutionBindingToken } from '../../runtime/execution/execution-binding-token.js';
import type {
  PermissionStrategyPort,
  ProtocolDriverId,
  ProtocolDriverPort,
  ResultParserId,
  ResultParserPort,
  RawResponseCapture,
} from '../../runtime/execution/index.js';
import { AGENT_FAULT_MESSAGES } from '../../runtime/policy/index.js';
import type { AgentDefinitionContract, AgentFault } from '../../runtime/spec/index.js';
import { CodexPermissionStrategy } from '../../strategies/permissions/index.js';
import { NativeStdioProtocolDriver } from '../../strategies/protocol-driver/native-stdio/native-stdio-protocol-driver.js';
import { CodexJsonlResultParser } from '../../strategies/result-parser/index.js';

type PermissionStrategyId = AgentDefinitionContract['protocol']['permissionStrategy'];
type PromptDelivery = AgentDefinitionContract['delivery']['prompt'];
type ResultSchemaDelivery = AgentDefinitionContract['delivery']['resultSchema'];
type ResultDelivery = AgentDefinitionContract['delivery']['result'];

type InstalledImplementation = ProtocolDriverPort | PermissionStrategyPort | InstalledParserFactory;
type InstalledParserFactory = new (
  maxBytes: number,
  rawResponseCapture?: RawResponseCapture,
) => ResultParserPort;

interface BindingKey {
  readonly protocolDriverId: ProtocolDriverId;
  readonly resultParserId?: ResultParserId;
  readonly permissionStrategyId: PermissionStrategyId;
  readonly delivery: {
    readonly prompt: PromptDelivery;
    readonly resultSchema: ResultSchemaDelivery;
    readonly result: ResultDelivery;
  };
}

interface InstalledBinding extends BindingKey {
  readonly driver: InstalledImplementation;
  readonly parser?: InstalledImplementation;
  readonly permission: PermissionStrategyPort;
}

const nativeStdioDriver = new NativeStdioProtocolDriver();

const installedDrivers = Object.freeze(
  new Map<ProtocolDriverId, ProtocolDriverPort>([['native/stdio-v1', nativeStdioDriver]]),
);
const installedParsers = Object.freeze(
  new Map<ResultParserId, InstalledParserFactory>([['codex-jsonl/v1', CodexJsonlResultParser]]),
);
const installedPermissions = Object.freeze(
  new Map<PermissionStrategyId, PermissionStrategyPort>([
    ['codex-cli/v1', CodexPermissionStrategy],
  ]),
);

const unsupportedFault = (): AgentFault =>
  Object.freeze({
    code: 'revo.agent.strategy_unsupported',
    message: AGENT_FAULT_MESSAGES.strategyUnsupported,
    phase: 'construction',
    retryable: false,
  });

const internalFault = (): AgentFault =>
  Object.freeze({
    code: 'revo.agent.internal',
    message: AGENT_FAULT_MESSAGES.internalConstruction,
    phase: 'preflight',
    retryable: false,
  });

const isNativeDelivery = (delivery: AgentDefinitionContract['delivery']): boolean =>
  delivery.prompt !== 'protocol' &&
  delivery.resultSchema !== 'protocol' &&
  delivery.result === 'stdout';

const isAcpDelivery = (delivery: AgentDefinitionContract['delivery']): boolean =>
  delivery.prompt === 'protocol' &&
  delivery.resultSchema === 'protocol' &&
  delivery.result === 'protocol';

const isCoherentBinding = (definition: AgentDefinitionContract): boolean => {
  const { protocol, delivery } = definition;
  if (protocol.driver === 'native/stdio-v1') {
    if (protocol.resultParser === undefined || !isNativeDelivery(delivery)) return false;
    return (
      (protocol.resultParser === 'codex-jsonl/v1' &&
        protocol.permissionStrategy === 'codex-cli/v1') ||
      (protocol.resultParser === 'claude-stream-json/v1' &&
        protocol.permissionStrategy === 'claude-cli/v1')
    );
  }
  return (
    protocol.resultParser === undefined &&
    protocol.permissionStrategy === 'acp/v1' &&
    isAcpDelivery(delivery)
  );
};

const bindingKey = (definition: AgentDefinitionContract): BindingKey =>
  Object.freeze({
    protocolDriverId: definition.protocol.driver,
    ...(definition.protocol.resultParser === undefined
      ? {}
      : { resultParserId: definition.protocol.resultParser }),
    permissionStrategyId: definition.protocol.permissionStrategy,
    delivery: Object.freeze({
      prompt: definition.delivery.prompt,
      resultSchema: definition.delivery.resultSchema,
      result: definition.delivery.result,
    }),
  });

const resolveInstalledBinding = (definition: AgentDefinitionContract): InstalledBinding => {
  if (!isCoherentBinding(definition)) throw new AgentManagerError(unsupportedFault());
  const key = bindingKey(definition);
  const driver = installedDrivers.get(key.protocolDriverId);
  const parser =
    key.resultParserId === undefined ? undefined : installedParsers.get(key.resultParserId);
  const permission = installedPermissions.get(key.permissionStrategyId);
  if (
    driver === undefined ||
    permission === undefined ||
    (key.resultParserId !== undefined && parser === undefined)
  )
    throw new AgentManagerError(unsupportedFault());
  return Object.freeze({ ...key, driver, ...(parser === undefined ? {} : { parser }), permission });
};

const sameInstalledBinding = (left: InstalledBinding, right: InstalledBinding): boolean =>
  left.protocolDriverId === right.protocolDriverId &&
  left.resultParserId === right.resultParserId &&
  left.permissionStrategyId === right.permissionStrategyId &&
  left.delivery.prompt === right.delivery.prompt &&
  left.delivery.resultSchema === right.delivery.resultSchema &&
  left.delivery.result === right.delivery.result &&
  left.driver === right.driver &&
  left.parser === right.parser &&
  left.permission === right.permission;

export class InstalledBindingRegistry {
  private readonly byDefinitionDigest = new Map<string, InstalledBinding>();

  private constructor(definitions: readonly ValidatedDefinition[]) {
    for (const definition of definitions)
      this.byDefinitionDigest.set(
        definition.definitionDigest,
        resolveInstalledBinding(definition.definition),
      );
    Object.freeze(this);
  }

  static create(definitions: readonly ValidatedDefinition[]): InstalledBindingRegistry {
    return new InstalledBindingRegistry(definitions);
  }

  static resolveProtocolDriver(protocolDriverId: ProtocolDriverId): ProtocolDriverPort | undefined {
    return resolveInstalledProtocolDriver(protocolDriverId);
  }

  static resolveResultParser(
    resultParserId: ResultParserId,
    maxBytes: number,
    rawResponseCapture?: RawResponseCapture,
  ): ResultParserPort | undefined {
    return resolveInstalledResultParser(resultParserId, maxBytes, rawResponseCapture);
  }

  createBinding(target: ValidatedDefinition): Readonly<{
    readonly binding: BindingKey;
    readonly bindingToken: ExecutionBindingToken;
    readonly permissionStrategy: PermissionStrategyPort;
  }> {
    const expected = this.byDefinitionDigest.get(target.definitionDigest);
    if (expected === undefined) throw new AgentManagerError(internalFault());
    let actual: InstalledBinding;
    try {
      actual = resolveInstalledBinding(target.definition);
    } catch {
      throw new AgentManagerError(internalFault());
    }
    if (!sameInstalledBinding(expected, actual)) throw new AgentManagerError(internalFault());
    const binding = Object.freeze({
      protocolDriverId: expected.protocolDriverId,
      ...(expected.resultParserId === undefined ? {} : { resultParserId: expected.resultParserId }),
      permissionStrategyId: expected.permissionStrategyId,
      delivery: expected.delivery,
    });
    return Object.freeze({
      binding,
      permissionStrategy: expected.permission,
      bindingToken: ExecutionBindingToken.create({
        agentId: target.definition.id,
        agentVersion: target.definition.version,
        definitionDigest: target.definitionDigest,
        ...binding,
      }),
    });
  }
}

const resolveInstalledProtocolDriver = (
  protocolDriverId: ProtocolDriverId,
): ProtocolDriverPort | undefined => {
  return installedDrivers.get(protocolDriverId);
};

const resolveInstalledResultParser = (
  resultParserId: ResultParserId,
  maxBytes: number,
  rawResponseCapture?: RawResponseCapture,
): ResultParserPort | undefined => {
  const Parser = installedParsers.get(resultParserId);
  return Parser === undefined ? undefined : new Parser(maxBytes, rawResponseCapture);
};
