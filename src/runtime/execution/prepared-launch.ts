import type { AgentValidationDetails, JsonObject } from '../spec/index.js';
import { canonicalEffectiveInputs } from './canonical-effective-inputs.js';
import { ExecutionBindingToken } from './execution-binding-token.js';
import type { ResultSchemaValidator } from './result-schema-validator.js';

interface OutputResourcePlan {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly needsPromptFile: boolean;
  readonly needsResultSchemaFile: boolean;
}

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

interface PreparedLaunchOptions {
  readonly pin: PreparedLaunchPin;
  readonly executable: string;
  readonly reportedVersion: string;
  readonly limits: PreparedLaunchLimits;
  readonly effectiveParameters: JsonObject;
  readonly effectivePermissions: JsonObject;
  readonly childEnvironment: Readonly<Record<string, string>>;
  readonly childEnvironmentSecretValues: readonly string[];
  readonly secretValues: readonly string[];
  readonly resultSchemaValidator: ResultSchemaValidator;
  readonly outputResourcePlan: OutputResourcePlan;
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

interface PreparedLaunchMaterial extends PreparedLaunchOptions {
  readonly binding: PreparedLaunchBinding;
  readonly bindingToken: unknown;
}

const preparedLaunchKeys = Object.freeze([
  'pin',
  'executable',
  'reportedVersion',
  'limits',
  'effectiveParameters',
  'effectivePermissions',
  'childEnvironment',
  'childEnvironmentSecretValues',
  'secretValues',
  'resultSchemaValidator',
  'outputResourcePlan',
  'binding',
  'bindingToken',
]);

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

const isValidatorFunction = (value: unknown): value is (input: JsonObject) => unknown =>
  typeof value === 'function';

const isValidationDetails = (value: unknown): value is AgentValidationDetails =>
  value !== null &&
  typeof value === 'object' &&
  Array.isArray(Object.getOwnPropertyDescriptor(value, 'diagnostics')?.value) &&
  typeof Object.getOwnPropertyDescriptor(value, 'truncated')?.value === 'boolean';

const ownResultSchemaValidator = (value: object): ResultSchemaValidator | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(value, 'resultSchemaValidator');
  if (!isDataDescriptor(descriptor)) return undefined;
  const candidate = descriptor.value;
  if (candidate === null || typeof candidate !== 'object' || !isPlainObservedObject(candidate))
    return undefined;
  if (!hasExactKeys(candidate, ['validate'])) return undefined;
  const validateDescriptor = Object.getOwnPropertyDescriptor(candidate, 'validate');
  if (!isDataDescriptor(validateDescriptor) || !isValidatorFunction(validateDescriptor.value))
    return undefined;
  const validate = validateDescriptor.value;
  return Object.freeze({
    validate: (input: JsonObject) => {
      const result = validate(input);
      if (result === undefined || isValidationDetails(result)) return result;
      throw new Error('Prepared result schema validator returned invalid diagnostics.');
    },
  });
};

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

const createStringRecord = (): Record<string, string> => {
  const record: Record<string, string> = {};
  Object.setPrototypeOf(record, null);
  return record;
};

const appendStringEntry = (target: Record<string, string>, key: string, value: string): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  });
};

const copyStringRecord = (value: unknown): Readonly<Record<string, string>> | undefined => {
  if (value === null || typeof value !== 'object') return undefined;
  if (!isPlainObservedObject(value)) return undefined;
  const record = createStringRecord();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== 'string'
    )
      return undefined;
    appendStringEntry(record, key, descriptor.value);
  }
  return Object.freeze(record);
};

const copyOutputResourcePlan = (value: unknown): OutputResourcePlan | undefined => {
  if (value === null || typeof value !== 'object') return undefined;
  if (!isPlainObservedObject(value)) return undefined;
  if (
    !hasExactKeys(value, [
      'invocationId',
      'outputDirectory',
      'needsPromptFile',
      'needsResultSchemaFile',
    ])
  )
    return undefined;
  const invocationId = ownNonEmptyString(value, 'invocationId');
  const outputDirectory = ownNonEmptyString(value, 'outputDirectory');
  const needsPromptFile = Object.getOwnPropertyDescriptor(value, 'needsPromptFile');
  const needsResultSchemaFile = Object.getOwnPropertyDescriptor(value, 'needsResultSchemaFile');
  if (
    invocationId === undefined ||
    outputDirectory === undefined ||
    !isDataDescriptor(needsPromptFile) ||
    !isDataDescriptor(needsResultSchemaFile) ||
    typeof needsPromptFile.value !== 'boolean' ||
    typeof needsResultSchemaFile.value !== 'boolean'
  )
    return undefined;
  return Object.freeze({
    invocationId,
    outputDirectory,
    needsPromptFile: needsPromptFile.value,
    needsResultSchemaFile: needsResultSchemaFile.value,
  });
};

const copyStringArray = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!isDataDescriptor(lengthDescriptor)) return undefined;
  const length = lengthDescriptor.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return undefined;
  const result: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== 'string'
    )
      return undefined;
    result.push(descriptor.value);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || !keys.includes('length')) return undefined;
  for (let index = 0; index < length; index += 1) {
    if (!keys.includes(String(index))) return undefined;
  }
  return Object.freeze(result);
};

const ownCopiedValue = <Value>(
  source: object,
  key: string,
  copy: (value: unknown) => Value | undefined,
): Value | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return isDataDescriptor(descriptor) ? copy(descriptor.value) : undefined;
};

const copyPreparedLaunchPin = (value: object): PreparedLaunchPin | undefined => {
  const pinDescriptor = Object.getOwnPropertyDescriptor(value, 'pin');
  if (
    !isDataDescriptor(pinDescriptor) ||
    pinDescriptor.value === null ||
    typeof pinDescriptor.value !== 'object' ||
    !isPlainObservedObject(pinDescriptor.value) ||
    !hasExactKeys(pinDescriptor.value, ['agentId', 'agentVersion', 'definitionDigest'])
  )
    return undefined;
  const agentId = ownNonEmptyString(pinDescriptor.value, 'agentId');
  const agentVersion = ownNonEmptyString(pinDescriptor.value, 'agentVersion');
  const definitionDigest = ownNonEmptyString(pinDescriptor.value, 'definitionDigest');
  if (agentId === undefined || agentVersion === undefined || definitionDigest === undefined)
    return undefined;
  return Object.freeze({ agentId, agentVersion, definitionDigest });
};

const copyPreparedLaunchMaterial = (value: object): PreparedLaunchMaterial | undefined => {
  const pin = copyPreparedLaunchPin(value);
  const executable = ownNonEmptyString(value, 'executable');
  const reportedVersion = ownNonEmptyString(value, 'reportedVersion');
  const limits = ownCopiedValue(value, 'limits', copyLimits);
  const effectiveParameters = ownCopiedValue(
    value,
    'effectiveParameters',
    canonicalEffectiveInputs.parameters,
  );
  const effectivePermissions = ownCopiedValue(
    value,
    'effectivePermissions',
    canonicalEffectiveInputs.permissions,
  );
  const childEnvironment = ownCopiedValue(value, 'childEnvironment', copyStringRecord);
  const childEnvironmentSecretValues = ownCopiedValue(
    value,
    'childEnvironmentSecretValues',
    copyStringArray,
  );
  const secretValues = ownCopiedValue(value, 'secretValues', copyStringArray);
  const resultSchemaValidator = ownResultSchemaValidator(value);
  const outputResourcePlan = ownCopiedValue(value, 'outputResourcePlan', copyOutputResourcePlan);
  const binding = ownCopiedValue(value, 'binding', copyBinding);
  const bindingTokenDescriptor = Object.getOwnPropertyDescriptor(value, 'bindingToken');
  const bindingToken = isDataDescriptor(bindingTokenDescriptor)
    ? bindingTokenDescriptor.value
    : undefined;
  if (
    pin === undefined ||
    executable === undefined ||
    reportedVersion === undefined ||
    limits === undefined ||
    effectiveParameters === undefined ||
    effectivePermissions === undefined ||
    childEnvironment === undefined ||
    childEnvironmentSecretValues === undefined ||
    secretValues === undefined ||
    resultSchemaValidator === undefined ||
    outputResourcePlan === undefined ||
    binding === undefined
  )
    return undefined;
  return Object.freeze({
    pin,
    executable,
    reportedVersion,
    limits,
    effectiveParameters,
    effectivePermissions,
    childEnvironment,
    childEnvironmentSecretValues,
    secretValues,
    resultSchemaValidator,
    outputResourcePlan,
    binding,
    bindingToken,
  });
};

const hasValidBindingToken = (material: PreparedLaunchMaterial): boolean =>
  ExecutionBindingToken.matches(material.bindingToken, {
    ...material.pin,
    ...material.binding,
  });

export class PreparedLaunch {
  readonly childEnvironment!: Readonly<Record<string, string>>;
  readonly childEnvironmentSecretValues!: readonly string[];
  readonly secretValues!: readonly string[];
  readonly effectiveParameters: JsonObject;
  readonly effectivePermissions: JsonObject;
  readonly resultSchemaValidator!: ResultSchemaValidator;
  readonly outputResourcePlan!: OutputResourcePlan;
  readonly pin: PreparedLaunchPin;
  readonly executable: string;
  readonly limits: PreparedLaunchLimits;
  readonly reportedVersion: string;

  private constructor(options: PreparedLaunchOptions) {
    Object.defineProperty(this, 'childEnvironment', {
      value: options.childEnvironment,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'childEnvironmentSecretValues', {
      value: options.childEnvironmentSecretValues,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'secretValues', {
      value: options.secretValues,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    this.effectiveParameters = options.effectiveParameters;
    this.effectivePermissions = options.effectivePermissions;
    Object.defineProperty(this, 'resultSchemaValidator', {
      value: options.resultSchemaValidator,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'outputResourcePlan', {
      value: options.outputResourcePlan,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    this.pin = Object.freeze({
      agentId: options.pin.agentId,
      agentVersion: options.pin.agentVersion,
      definitionDigest: options.pin.definitionDigest,
    });
    this.executable = options.executable;
    this.limits = options.limits;
    this.reportedVersion = options.reportedVersion;
    Object.freeze(this);
  }

  static create(value: unknown): PreparedLaunch | undefined {
    if (value === null || typeof value !== 'object') return undefined;
    if (!isPlainObservedObject(value)) return undefined;
    if (!hasExactKeys(value, preparedLaunchKeys)) return undefined;
    const material = copyPreparedLaunchMaterial(value);
    if (material === undefined || !hasValidBindingToken(material)) return undefined;
    return new PreparedLaunch(material);
  }
}
