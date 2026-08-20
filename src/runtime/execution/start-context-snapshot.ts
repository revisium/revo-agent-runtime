import type { ChildEnvironmentRequest } from './child-environment/index.js';
import { reflectiveObjectRead } from './reflective-object-read.js';

const { isPlainObservedObject, ownEnumerableData, enumerableKeys, isDataDescriptor } =
  reflectiveObjectRead;

const contextKeys = Object.freeze(['signal', 'environment']);
const environmentKeys = Object.freeze(['inherit', 'variables', 'secrets']);
const maximumEnvironmentEntries = 4_096;

const createStringRecord = (): Record<string, string> => {
  const record: Record<string, string> = {};
  Object.setPrototypeOf(record, null);
  return record;
};

const defineStringEntry = (target: Record<string, string>, key: string, value: string): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  });
};

const readDenseStringArray = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!isDataDescriptor(lengthDescriptor)) return undefined;
  const length = lengthDescriptor.value;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximumEnvironmentEntries
  )
    return undefined;
  let observed = 0;
  for (const key of enumerableKeys(value)) {
    observed += 1;
    if (observed > length || key !== String(observed - 1) || !ownEnumerableData(value, key).valid)
      return undefined;
  }
  if (observed !== length) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || !keys.includes('length')) return undefined;
  for (let index = 0; index < length; index += 1) {
    if (!keys.includes(String(index))) return undefined;
  }
  const copy: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const read = ownEnumerableData(value, String(index));
    if (!read.valid || typeof read.value !== 'string') return undefined;
    copy.push(read.value);
  }
  return Object.freeze(copy);
};

const copyStringRecord = (value: unknown): Readonly<Record<string, string>> | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !isPlainObservedObject(value)
  )
    return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length > maximumEnvironmentEntries) return undefined;
  const copy = createStringRecord();
  for (const key of keys) {
    if (typeof key !== 'string') return undefined;
    const read = ownEnumerableData(value, key);
    if (!read.valid || typeof read.value !== 'string') return undefined;
    defineStringEntry(copy, key, read.value);
  }
  return Object.freeze(copy);
};

const defaultEnvironment = Object.freeze({
  inherit: Object.freeze([]),
  variables: Object.freeze(createStringRecord()),
  secrets: Object.freeze(createStringRecord()),
});

const readEnvironment = (value: unknown): ChildEnvironmentRequest | undefined => {
  if (value === undefined) return defaultEnvironment;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !isPlainObservedObject(value)
  )
    return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !environmentKeys.includes(key)))
    return undefined;
  const inheritRead = ownEnumerableData(value, 'inherit');
  const variablesRead = ownEnumerableData(value, 'variables');
  const secretsRead = ownEnumerableData(value, 'secrets');
  if (keys.includes('inherit') && !inheritRead.valid) return undefined;
  if (keys.includes('variables') && !variablesRead.valid) return undefined;
  if (keys.includes('secrets') && !secretsRead.valid) return undefined;
  const inherit = inheritRead.valid
    ? readDenseStringArray(inheritRead.value)
    : defaultEnvironment.inherit;
  const variables = variablesRead.valid
    ? copyStringRecord(variablesRead.value)
    : defaultEnvironment.variables;
  const secrets = secretsRead.valid
    ? copyStringRecord(secretsRead.value)
    : defaultEnvironment.secrets;
  if (inherit === undefined || variables === undefined || secrets === undefined) return undefined;
  return Object.freeze({ inherit, variables, secrets });
};

export class StartContextSnapshot {
  readonly environment: ChildEnvironmentRequest;

  private constructor(environment: ChildEnvironmentRequest) {
    this.environment = environment;
    Object.freeze(this);
  }

  static create(value: unknown): StartContextSnapshot | undefined {
    if (value === undefined) return new StartContextSnapshot(defaultEnvironment);
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !isPlainObservedObject(value)
    )
      return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || !contextKeys.includes(key))) return undefined;
    const environmentRead = ownEnumerableData(value, 'environment');
    if (keys.includes('environment') && !environmentRead.valid) return undefined;
    const environment = readEnvironment(environmentRead.valid ? environmentRead.value : undefined);
    if (environment === undefined) return undefined;
    return new StartContextSnapshot(environment);
  }
}
