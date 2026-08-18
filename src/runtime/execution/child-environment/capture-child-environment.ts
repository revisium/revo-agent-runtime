import { reflectiveObjectRead } from '../reflective-object-read.js';
import type { ChildEnvironmentCapture } from './child-environment-capture.js';

const { isPlainObservedObject, isDataDescriptor, ownEnumerableData, enumerableKeys } =
  reflectiveObjectRead;

const keyPattern = /^[A-Za-z_]\w*$/;
const credentialLikePattern = /token|secret|password|credential|api[_-]?key|private[_-]?key/i;

const maxTotalKeys = 128;
const maxKeyBytes = 128;
const maxValueBytes = 65_536;
const maxTotalBytes = 262_144;
const parseStructuralLimit = 4_096;

const encoder = new TextEncoder();

type RejectionReason = Extract<ChildEnvironmentCapture, { status: 'rejected' }>['reason'];

const rejected = (reason: RejectionReason): ChildEnvironmentCapture =>
  Object.freeze({ status: 'rejected', reason });

interface ParsedEntry {
  readonly key: string;
  readonly value: string;
}

const readArrayLength = (value: readonly unknown[]): number | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!isDataDescriptor(descriptor)) return undefined;
  const length = descriptor.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return undefined;
  return length > parseStructuralLimit ? undefined : length;
};

const isDenseArrayOfKnownLength = (value: readonly unknown[], length: number): boolean => {
  let observed = 0;
  for (const key of enumerableKeys(value)) {
    observed += 1;
    if (observed > length || key !== String(observed - 1) || !ownEnumerableData(value, key).valid)
      return false;
  }
  return observed === length;
};

const readStringArray = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const length = readArrayLength(value);
  if (length === undefined || !isDenseArrayOfKnownLength(value, length)) return undefined;

  const result: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const read = ownEnumerableData(value, String(index));
    if (!read.valid || typeof read.value !== 'string') return undefined;
    result.push(read.value);
  }
  return Object.freeze(result);
};

const readStringRecord = (value: unknown): readonly ParsedEntry[] | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !isPlainObservedObject(value)
  )
    return undefined;

  const entries: ParsedEntry[] = [];
  for (const key of enumerableKeys(value)) {
    if (entries.length >= parseStructuralLimit) return undefined;
    const read = ownEnumerableData(value, key);
    if (!read.valid || typeof read.value !== 'string') return undefined;
    entries.push(Object.freeze({ key, value: read.value }));
  }
  return Object.freeze(entries);
};

interface ParsedRequest {
  readonly inherit: readonly string[];
  readonly variables: readonly ParsedEntry[];
  readonly secrets: readonly ParsedEntry[];
}

interface ParsedRequestAccumulator {
  inherit: readonly string[];
  variables: readonly ParsedEntry[];
  secrets: readonly ParsedEntry[];
}

const readRequestField = (
  value: object,
  key: string,
  target: ParsedRequestAccumulator,
): boolean => {
  const read = ownEnumerableData(value, key);
  if (!read.valid) return false;
  if (key === 'inherit') {
    const parsed = readStringArray(read.value);
    if (parsed === undefined) return false;
    target.inherit = parsed;
    return true;
  }
  if (key === 'variables') {
    const parsed = readStringRecord(read.value);
    if (parsed === undefined) return false;
    target.variables = parsed;
    return true;
  }
  if (key === 'secrets') {
    const parsed = readStringRecord(read.value);
    if (parsed === undefined) return false;
    target.secrets = parsed;
    return true;
  }
  return false;
};

const readRequest = (value: unknown): ParsedRequest | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !isPlainObservedObject(value)
  )
    return undefined;

  const parsed: ParsedRequestAccumulator = { inherit: [], variables: [], secrets: [] };

  for (const key of enumerableKeys(value)) {
    if (!readRequestField(value, key, parsed)) return undefined;
  }

  return Object.freeze(parsed);
};

const createRecord = (): Record<string, string> => {
  const record: Record<string, string> = {};
  Object.setPrototypeOf(record, null);
  return record;
};

const appendEntry = (target: Record<string, string>, key: string, value: string): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  });
};

const validateNames = (parsed: ParsedRequest): RejectionReason | undefined => {
  const nonSecretNames = [...parsed.inherit, ...parsed.variables.map((entry) => entry.key)];
  const allNames = [...nonSecretNames, ...parsed.secrets.map((entry) => entry.key)];

  for (const name of allNames) {
    if (!keyPattern.test(name)) return 'invalid_key';
  }
  for (const name of nonSecretNames) {
    if (credentialLikePattern.test(name)) return 'credential_like_name';
  }

  const seenNames = new Set<string>();
  for (const name of allNames) {
    if (seenNames.has(name)) return 'duplicate_name';
    seenNames.add(name);
  }
  return undefined;
};

const resolveInheritedEntries = (
  names: readonly string[],
  hostSnapshot: Readonly<Record<string, string>>,
): readonly ParsedEntry[] | undefined => {
  const entries: ParsedEntry[] = [];
  for (const name of names) {
    const read = ownEnumerableData(hostSnapshot, name);
    if (!read.valid || typeof read.value !== 'string') return undefined;
    entries.push(Object.freeze({ key: name, value: read.value }));
  }
  return entries;
};

const hasEmptySecretValue = (entries: readonly ParsedEntry[]): boolean => {
  for (const entry of entries) {
    if (entry.value.length === 0) return true;
  }
  return false;
};

const validateEntryBounds = (entries: readonly ParsedEntry[]): RejectionReason | undefined => {
  if (entries.length > maxTotalKeys) return 'too_many_keys';

  let totalBytes = 0;
  for (const entry of entries) {
    const keyBytes = encoder.encode(entry.key).byteLength;
    if (keyBytes > maxKeyBytes) return 'key_too_large';
    const valueBytes = encoder.encode(entry.value).byteLength;
    if (valueBytes > maxValueBytes) return 'value_too_large';
    totalBytes += keyBytes + valueBytes;
    if (totalBytes > maxTotalBytes) return 'total_size_exceeded';
  }
  return undefined;
};

const createEnvironment = (entries: readonly ParsedEntry[]): Readonly<Record<string, string>> => {
  const environment = createRecord();
  for (const entry of entries) appendEntry(environment, entry.key, entry.value);
  return Object.freeze(environment);
};

const uniqueSecretValues = (entries: readonly ParsedEntry[]): readonly string[] => {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.value)) continue;
    seen.add(entry.value);
    values.push(entry.value);
  }
  return Object.freeze(values);
};

export function captureChildEnvironment(
  request: unknown,
  hostSnapshot: Readonly<Record<string, string>>,
): ChildEnvironmentCapture {
  try {
    const parsed = readRequest(request);
    if (parsed === undefined) return rejected('invalid_request');

    const nameRejection = validateNames(parsed);
    if (nameRejection !== undefined) return rejected(nameRejection);

    const resolvedInherit = resolveInheritedEntries(parsed.inherit, hostSnapshot);
    if (resolvedInherit === undefined) return rejected('missing_inherit_variable');
    if (hasEmptySecretValue(parsed.secrets)) return rejected('empty_secret_value');
    const combined = [...resolvedInherit, ...parsed.variables, ...parsed.secrets];
    const boundsRejection = validateEntryBounds(combined);
    if (boundsRejection !== undefined) return rejected(boundsRejection);

    return Object.freeze({
      status: 'captured',
      environment: createEnvironment(combined),
      secretValues: uniqueSecretValues(parsed.secrets),
    });
  } catch {
    return rejected('invalid_request');
  }
}
