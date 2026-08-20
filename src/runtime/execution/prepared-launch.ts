import type { AgentValidationDetails, JsonObject } from '../spec/index.js';
import type { InterpretedArgumentTemplate } from './argument-template-interpretation/index.js';
import { canonicalEffectiveInputs } from './canonical-effective-inputs.js';
import { ExecutionBindingToken } from './execution-binding-token.js';
import type { ExecutionBinding } from './execution-binding.js';
import type { OutputResourcePlan } from './output-resource-plan.js';
import type { PreparedInvocationPayloads } from './payload-preparation/index.js';
import { readExecutionBinding } from './read-execution-binding.js';
import type { ResultSchemaValidator } from './result-schema-validator.js';

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
  readonly binding: ExecutionBinding;
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
  readonly interpretedArgumentTemplate: InterpretedArgumentTemplate;
  readonly preparedPayloads: PreparedInvocationPayloads;
}

interface PreparedLaunchMaterial extends PreparedLaunchOptions {
  readonly binding: ExecutionBinding;
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
  'interpretedArgumentTemplate',
  'preparedPayloads',
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

const copyBytes = (value: unknown): Uint8Array | undefined => {
  if (!(value instanceof Uint8Array)) return undefined;
  return new Uint8Array(value);
};

const copyPreparedPayloadFile = (
  value: unknown,
): PreparedInvocationPayloads['files'][number] | undefined => {
  if (value === null || typeof value !== 'object') return undefined;
  if (!isPlainObservedObject(value)) return undefined;
  if (!hasExactKeys(value, ['kind', 'path', 'bytes'])) return undefined;
  const kind = ownString(value, 'kind');
  const path = ownNonEmptyString(value, 'path');
  const bytes = ownCopiedValue(value, 'bytes', copyBytes);
  if ((kind !== 'prompt' && kind !== 'result-schema') || path === undefined || bytes === undefined)
    return undefined;
  return Object.freeze({ kind, path, bytes });
};

const copyPreparedPayloadFiles = (
  value: unknown,
): readonly PreparedInvocationPayloads['files'][number][] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!isDataDescriptor(lengthDescriptor)) return undefined;
  const length = lengthDescriptor.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return undefined;
  const result: PreparedInvocationPayloads['files'][number][] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor?.enumerable !== true || !isDataDescriptor(descriptor)) return undefined;
    const item = copyPreparedPayloadFile(descriptor.value);
    if (item === undefined) return undefined;
    result.push(item);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || !keys.includes('length')) return undefined;
  return Object.freeze(result);
};

const copyPreparedPayloads = (value: unknown): PreparedInvocationPayloads | undefined => {
  if (value === null || typeof value !== 'object') return undefined;
  if (!isPlainObservedObject(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (!(keys.length === 2 || keys.length === 3)) return undefined;
  if (!keys.includes('arguments') || !keys.includes('files')) return undefined;
  const args = ownCopiedValue(value, 'arguments', copyStringArray);
  const files = ownCopiedValue(value, 'files', copyPreparedPayloadFiles);
  const stdin = keys.includes('stdin') ? ownCopiedValue(value, 'stdin', copyBytes) : undefined;
  if (args === undefined || files === undefined || (keys.includes('stdin') && stdin === undefined))
    return undefined;
  return Object.freeze({ arguments: args, ...(stdin === undefined ? {} : { stdin }), files });
};

const copyInterpretedArgumentTemplate = (
  value: unknown,
): InterpretedArgumentTemplate | undefined => {
  if (!Array.isArray(value)) return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!isDataDescriptor(lengthDescriptor)) return undefined;
  const length = lengthDescriptor.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return undefined;
  const result: Array<InterpretedArgumentTemplate[number]> = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor?.enumerable !== true || !isDataDescriptor(descriptor)) return undefined;
    const item = copyInterpretedArgumentTemplateItem(descriptor.value);
    if (item === undefined) return undefined;
    result.push(item);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || !keys.includes('length')) return undefined;
  return Object.freeze(result);
};

const copyInterpretedArgumentTemplateItem = (
  value: unknown,
): InterpretedArgumentTemplate[number] | undefined => {
  if (value === null || typeof value !== 'object') return undefined;
  if (!isPlainObservedObject(value)) return undefined;
  const kind = ownString(value, 'kind');
  if (kind === 'arguments') {
    if (!hasExactKeys(value, ['kind', 'arguments'])) return undefined;
    const args = ownCopiedValue(value, 'arguments', copyStringArray);
    return args === undefined ? undefined : Object.freeze({ kind, arguments: args });
  }
  if (
    kind === 'prompt' ||
    kind === 'prompt-file' ||
    kind === 'result-schema' ||
    kind === 'result-schema-file'
  ) {
    return hasExactKeys(value, ['kind']) ? Object.freeze({ kind }) : undefined;
  }
  return undefined;
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
  const interpretedArgumentTemplate = ownCopiedValue(
    value,
    'interpretedArgumentTemplate',
    copyInterpretedArgumentTemplate,
  );
  const preparedPayloads = ownCopiedValue(value, 'preparedPayloads', copyPreparedPayloads);
  const binding = ownCopiedValue(value, 'binding', readExecutionBinding);
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
    interpretedArgumentTemplate === undefined ||
    preparedPayloads === undefined ||
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
    interpretedArgumentTemplate,
    preparedPayloads,
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
  readonly interpretedArgumentTemplate!: InterpretedArgumentTemplate;
  readonly preparedPayloads!: PreparedInvocationPayloads;
  readonly pin: PreparedLaunchPin;
  readonly executable: string;
  readonly limits: PreparedLaunchLimits;
  readonly reportedVersion: string;
  readonly binding: ExecutionBinding;

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
    Object.defineProperty(this, 'interpretedArgumentTemplate', {
      value: options.interpretedArgumentTemplate,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'preparedPayloads', {
      value: options.preparedPayloads,
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
    this.binding = options.binding;
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
