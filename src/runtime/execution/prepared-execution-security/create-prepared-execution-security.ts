import { reflectiveObjectRead } from '../reflective-object-read.js';
import { isRegisteredSecrets } from '../secret-registration/index.js';
import type { PreparedExecutionSecurityRequest } from './prepared-execution-security-request.js';
import { PreparedExecutionSecurity } from './prepared-execution-security.js';

const { enumerableKeys, isPlainObservedObject, ownEnumerableData } = reflectiveObjectRead;

const readStringRecord = (value: unknown): Readonly<Record<string, string>> | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !isPlainObservedObject(value)
  )
    return undefined;

  const entries: Record<string, string> = {};
  for (const key of enumerableKeys(value)) {
    const read = ownEnumerableData(value, key);
    if (!read.valid || typeof read.value !== 'string') return undefined;
    entries[key] = read.value;
  }
  return entries;
};

export const createPreparedExecutionSecurity = (
  request: PreparedExecutionSecurityRequest,
): PreparedExecutionSecurity | undefined => {
  if (!isRegisteredSecrets(request.registeredSecrets)) return undefined;
  const environment = readStringRecord(request.childEnvironment);
  if (environment === undefined) return undefined;
  return PreparedExecutionSecurity.create({
    invocationId: request.invocationId,
    environment: Object.freeze({ ...environment }),
    redaction: request.registeredSecrets,
  });
};
