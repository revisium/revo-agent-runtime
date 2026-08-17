import { reflectiveObjectRead } from '../reflective-object-read.js';
import type { ChildEnvironmentCapture } from './child-environment-capture.js';

const { isPlainObservedObject, isDataDescriptor, ownEnumerableData, enumerableKeys } =
  reflectiveObjectRead;

const keyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
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

const readRequest = (value: unknown): ParsedRequest | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !isPlainObservedObject(value)
  )
    return undefined;

  let inherit: readonly string[] = [];
  let variables: readonly ParsedEntry[] = [];
  let secrets: readonly ParsedEntry[] = [];

  for (const key of enumerableKeys(value)) {
    const read = ownEnumerableData(value, key);
    if (!read.valid) return undefined;
    if (key === 'inherit') {
      const parsed = readStringArray(read.value);
      if (parsed === undefined) return undefined;
      inherit = parsed;
    } else if (key === 'variables') {
      const parsed = readStringRecord(read.value);
      if (parsed === undefined) return undefined;
      variables = parsed;
    } else if (key === 'secrets') {
      const parsed = readStringRecord(read.value);
      if (parsed === undefined) return undefined;
      secrets = parsed;
    } else {
      return undefined;
    }
  }

  return Object.freeze({ inherit, variables, secrets });
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

export function captureChildEnvironment(
  request: unknown,
  hostSnapshot: Readonly<Record<string, string>>,
): ChildEnvironmentCapture {
  try {
    const parsed = readRequest(request);
    if (parsed === undefined) return rejected('invalid_request');

    const nonSecretNames = [...parsed.inherit, ...parsed.variables.map((entry) => entry.key)];
    const secretNames = parsed.secrets.map((entry) => entry.key);
    const allNames = [...nonSecretNames, ...secretNames];

    for (const name of allNames) {
      if (!keyPattern.test(name)) return rejected('invalid_key');
    }
    for (const name of nonSecretNames) {
      if (credentialLikePattern.test(name)) return rejected('credential_like_name');
    }
    const seenNames = new Set<string>();
    for (const name of allNames) {
      if (seenNames.has(name)) return rejected('duplicate_name');
      seenNames.add(name);
    }

    const resolvedInherit: ParsedEntry[] = [];
    for (const name of parsed.inherit) {
      const read = ownEnumerableData(hostSnapshot, name);
      if (!read.valid || typeof read.value !== 'string')
        return rejected('missing_inherit_variable');
      resolvedInherit.push(Object.freeze({ key: name, value: read.value }));
    }

    for (const entry of parsed.secrets) {
      if (entry.value.length === 0) return rejected('empty_secret_value');
    }

    const combined = [...resolvedInherit, ...parsed.variables, ...parsed.secrets];
    if (combined.length > maxTotalKeys) return rejected('too_many_keys');

    let totalBytes = 0;
    for (const entry of combined) {
      const keyBytes = encoder.encode(entry.key).byteLength;
      if (keyBytes > maxKeyBytes) return rejected('key_too_large');
      const valueBytes = encoder.encode(entry.value).byteLength;
      if (valueBytes > maxValueBytes) return rejected('value_too_large');
      totalBytes += keyBytes + valueBytes;
      if (totalBytes > maxTotalBytes) return rejected('total_size_exceeded');
    }

    const environment = createRecord();
    for (const entry of combined) appendEntry(environment, entry.key, entry.value);

    const secretValues: string[] = [];
    const seenSecretValues = new Set<string>();
    for (const entry of parsed.secrets) {
      if (seenSecretValues.has(entry.value)) continue;
      seenSecretValues.add(entry.value);
      secretValues.push(entry.value);
    }

    return Object.freeze({
      status: 'captured',
      environment: Object.freeze(environment),
      secretValues: Object.freeze(secretValues),
    });
  } catch {
    return rejected('invalid_request');
  }
}
