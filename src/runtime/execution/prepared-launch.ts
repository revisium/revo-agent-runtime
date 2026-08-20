import type { JsonObject } from '../spec/index.js';
import { canonicalEffectiveInputs } from './canonical-effective-inputs.js';
import { ExecutionBindingToken } from './execution-binding-token.js';

interface PreparedLaunchPin {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly definitionDigest: string;
}

interface DataDescriptor {
  readonly value: unknown;
}

interface PreparedLaunchLimits {
  readonly wallClockTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly maxEventBytes: number;
  readonly maxEventsFileBytes: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxRawResponseBytes: number;
}

interface PreparedLaunchBinding {
  readonly protocolDriverId: 'native/stdio-v1' | 'acp/v1';
  readonly resultParserId?: 'codex-jsonl/v1' | 'claude-stream-json/v1';
  readonly permissionStrategyId: 'codex-cli/v1' | 'claude-cli/v1' | 'acp/v1';
  readonly delivery: {
    readonly prompt: 'argument' | 'stdin' | 'file' | 'protocol';
    readonly resultSchema: 'argument' | 'file' | 'protocol';
    readonly result: 'stdout' | 'protocol';
  };
}

const hasExactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
};

const isPlainObservedObject = (value: object): boolean => {
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isDataDescriptor = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is DataDescriptor => descriptor !== undefined && Object.hasOwn(descriptor, 'value');

const ownNumber = (value: object, key: string): number | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!isDataDescriptor(descriptor)) return undefined;
  return typeof descriptor.value === 'number' && Number.isSafeInteger(descriptor.value)
    ? descriptor.value
    : undefined;
};

const copyLimits = (value: unknown): PreparedLaunchLimits | undefined => {
  if (value === null || typeof value !== 'object') return undefined;
  if (!isPlainObservedObject(value)) return undefined;
  if (
    !hasExactKeys(value, [
      'wallClockTimeoutMs',
      'idleTimeoutMs',
      'maxEventBytes',
      'maxEventsFileBytes',
      'maxStdoutBytes',
      'maxStderrBytes',
      'maxRawResponseBytes',
    ])
  )
    return undefined;
  const wallClockTimeoutMs = ownNumber(value, 'wallClockTimeoutMs');
  const idleTimeoutMs = ownNumber(value, 'idleTimeoutMs');
  const maxEventBytes = ownNumber(value, 'maxEventBytes');
  const maxEventsFileBytes = ownNumber(value, 'maxEventsFileBytes');
  const maxStdoutBytes = ownNumber(value, 'maxStdoutBytes');
  const maxStderrBytes = ownNumber(value, 'maxStderrBytes');
  const maxRawResponseBytes = ownNumber(value, 'maxRawResponseBytes');
  if (
    wallClockTimeoutMs === undefined ||
    idleTimeoutMs === undefined ||
    maxEventBytes === undefined ||
    maxEventsFileBytes === undefined ||
    maxStdoutBytes === undefined ||
    maxStderrBytes === undefined ||
    maxRawResponseBytes === undefined
  )
    return undefined;
  return Object.freeze({
    wallClockTimeoutMs,
    idleTimeoutMs,
    maxEventBytes,
    maxEventsFileBytes,
    maxStdoutBytes,
    maxStderrBytes,
    maxRawResponseBytes,
  });
};

const asProtocolDriverId = (
  value: unknown,
): PreparedLaunchBinding['protocolDriverId'] | undefined =>
  value === 'native/stdio-v1' || value === 'acp/v1' ? value : undefined;

const asResultParserId = (value: unknown): PreparedLaunchBinding['resultParserId'] | undefined =>
  value === 'codex-jsonl/v1' || value === 'claude-stream-json/v1' ? value : undefined;

const asPermissionStrategyId = (
  value: unknown,
): PreparedLaunchBinding['permissionStrategyId'] | undefined =>
  value === 'codex-cli/v1' || value === 'claude-cli/v1' || value === 'acp/v1' ? value : undefined;

const asPromptDelivery = (
  value: unknown,
): PreparedLaunchBinding['delivery']['prompt'] | undefined =>
  value === 'argument' || value === 'stdin' || value === 'file' || value === 'protocol'
    ? value
    : undefined;

const asResultSchemaDelivery = (
  value: unknown,
): PreparedLaunchBinding['delivery']['resultSchema'] | undefined =>
  value === 'argument' || value === 'file' || value === 'protocol' ? value : undefined;

const asResultDelivery = (
  value: unknown,
): PreparedLaunchBinding['delivery']['result'] | undefined =>
  value === 'stdout' || value === 'protocol' ? value : undefined;

const ownString = (value: object, key: string): string | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!isDataDescriptor(descriptor)) return undefined;
  return typeof descriptor.value === 'string' ? descriptor.value : undefined;
};

const copyBinding = (value: unknown): PreparedLaunchBinding | undefined => {
  if (value === null || typeof value !== 'object') return undefined;
  if (!isPlainObservedObject(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    !(
      (keys.length === 3 || keys.length === 4) &&
      keys.includes('protocolDriverId') &&
      keys.includes('permissionStrategyId') &&
      keys.includes('delivery')
    ) ||
    (keys.length === 4 && !keys.includes('resultParserId'))
  )
    return undefined;
  const protocolDriverId = asProtocolDriverId(ownString(value, 'protocolDriverId'));
  const resultParserId = keys.includes('resultParserId')
    ? asResultParserId(ownString(value, 'resultParserId'))
    : undefined;
  const permissionStrategyId = asPermissionStrategyId(ownString(value, 'permissionStrategyId'));
  const deliveryDescriptor = Object.getOwnPropertyDescriptor(value, 'delivery');
  if (
    protocolDriverId === undefined ||
    (keys.includes('resultParserId') && resultParserId === undefined) ||
    permissionStrategyId === undefined ||
    !isDataDescriptor(deliveryDescriptor) ||
    deliveryDescriptor.value === null ||
    typeof deliveryDescriptor.value !== 'object' ||
    !isPlainObservedObject(deliveryDescriptor.value) ||
    !hasExactKeys(deliveryDescriptor.value, ['prompt', 'resultSchema', 'result'])
  )
    return undefined;
  const prompt = asPromptDelivery(ownString(deliveryDescriptor.value, 'prompt'));
  const resultSchema = asResultSchemaDelivery(ownString(deliveryDescriptor.value, 'resultSchema'));
  const result = asResultDelivery(ownString(deliveryDescriptor.value, 'result'));
  if (prompt === undefined || resultSchema === undefined || result === undefined) return undefined;
  return Object.freeze({
    protocolDriverId,
    ...(resultParserId === undefined ? {} : { resultParserId }),
    permissionStrategyId,
    delivery: Object.freeze({ prompt, resultSchema, result }),
  });
};

const ownNonEmptyString = (value: object, key: string): string | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!isDataDescriptor(descriptor)) return undefined;
  return typeof descriptor.value === 'string' && descriptor.value.length > 0
    ? descriptor.value
    : undefined;
};

export class PreparedLaunch {
  readonly effectiveParameters: JsonObject;
  readonly effectivePermissions: JsonObject;
  readonly pin: PreparedLaunchPin;
  readonly executable: string;
  readonly limits: PreparedLaunchLimits;
  readonly reportedVersion: string;

  private constructor(
    pin: PreparedLaunchPin,
    executable: string,
    reportedVersion: string,
    limits: PreparedLaunchLimits,
    effectiveParameters: JsonObject,
    effectivePermissions: JsonObject,
  ) {
    this.effectiveParameters = effectiveParameters;
    this.effectivePermissions = effectivePermissions;
    this.pin = Object.freeze({
      agentId: pin.agentId,
      agentVersion: pin.agentVersion,
      definitionDigest: pin.definitionDigest,
    });
    this.executable = executable;
    this.limits = limits;
    this.reportedVersion = reportedVersion;
    Object.freeze(this);
  }

  static create(value: unknown): PreparedLaunch | undefined {
    if (value === null || typeof value !== 'object') return undefined;
    if (!isPlainObservedObject(value)) return undefined;
    if (
      !hasExactKeys(value, [
        'pin',
        'executable',
        'reportedVersion',
        'limits',
        'effectiveParameters',
        'effectivePermissions',
        'binding',
        'bindingToken',
      ])
    )
      return undefined;
    const pinDescriptor = Object.getOwnPropertyDescriptor(value, 'pin');
    if (
      !isDataDescriptor(pinDescriptor) ||
      pinDescriptor.value === null ||
      typeof pinDescriptor.value !== 'object'
    )
      return undefined;
    if (!isPlainObservedObject(pinDescriptor.value)) return undefined;
    if (!hasExactKeys(pinDescriptor.value, ['agentId', 'agentVersion', 'definitionDigest']))
      return undefined;
    const agentId = ownNonEmptyString(pinDescriptor.value, 'agentId');
    const agentVersion = ownNonEmptyString(pinDescriptor.value, 'agentVersion');
    const definitionDigest = ownNonEmptyString(pinDescriptor.value, 'definitionDigest');
    const executable = ownNonEmptyString(value, 'executable');
    const reportedVersion = ownNonEmptyString(value, 'reportedVersion');
    const limitsDescriptor = Object.getOwnPropertyDescriptor(value, 'limits');
    const limits = isDataDescriptor(limitsDescriptor)
      ? copyLimits(limitsDescriptor.value)
      : undefined;
    const effectiveParametersDescriptor = Object.getOwnPropertyDescriptor(
      value,
      'effectiveParameters',
    );
    const effectiveParameters = isDataDescriptor(effectiveParametersDescriptor)
      ? canonicalEffectiveInputs.parameters(effectiveParametersDescriptor.value)
      : undefined;
    const effectivePermissionsDescriptor = Object.getOwnPropertyDescriptor(
      value,
      'effectivePermissions',
    );
    const effectivePermissions = isDataDescriptor(effectivePermissionsDescriptor)
      ? canonicalEffectiveInputs.permissions(effectivePermissionsDescriptor.value)
      : undefined;
    const bindingDescriptor = Object.getOwnPropertyDescriptor(value, 'binding');
    const binding = isDataDescriptor(bindingDescriptor)
      ? copyBinding(bindingDescriptor.value)
      : undefined;
    const bindingTokenDescriptor = Object.getOwnPropertyDescriptor(value, 'bindingToken');
    const bindingToken = isDataDescriptor(bindingTokenDescriptor)
      ? bindingTokenDescriptor.value
      : undefined;
    if (
      agentId === undefined ||
      agentVersion === undefined ||
      definitionDigest === undefined ||
      executable === undefined ||
      reportedVersion === undefined ||
      limits === undefined ||
      effectiveParameters === undefined ||
      effectivePermissions === undefined ||
      binding === undefined ||
      !ExecutionBindingToken.matches(bindingToken, {
        agentId,
        agentVersion,
        definitionDigest,
        ...binding,
      })
    )
      return undefined;
    return new PreparedLaunch(
      { agentId, agentVersion, definitionDigest },
      executable,
      reportedVersion,
      limits,
      effectiveParameters,
      effectivePermissions,
    );
  }
}
