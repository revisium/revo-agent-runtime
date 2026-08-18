import { reflectiveObjectRead } from '../reflective-object-read.js';
import type { SealedSecretRegistration } from './sealed-secret-registration.js';
import type { SecretRegistrationRequest } from './secret-registration-request.js';

type SecretListRead =
  | Readonly<{ status: 'valid'; values: readonly string[] }>
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'invalid' }>;

const readSecretList = (value: unknown): SecretListRead => {
  if (!Array.isArray(value)) return { status: 'invalid' };
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!reflectiveObjectRead.isDataDescriptor(lengthDescriptor)) return { status: 'invalid' };
  const length = lengthDescriptor.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0)
    return { status: 'invalid' };

  const values: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!reflectiveObjectRead.isEnumerableDataDescriptor(descriptor)) return { status: 'invalid' };
    if (typeof descriptor.value !== 'string') return { status: 'invalid' };
    if (descriptor.value.length === 0) return { status: 'empty' };
    values.push(descriptor.value);
  }
  for (const key of reflectiveObjectRead.enumerableKeys(value)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) return { status: 'invalid' };
  }
  return { status: 'valid', values };
};

interface SecretRequestFields {
  readonly configured: unknown;
  readonly invocation: unknown;
}

const readRequestFields = (request: object): SecretRequestFields | undefined => {
  const keys = [...reflectiveObjectRead.enumerableKeys(request)];
  if (
    keys.length !== 2 ||
    !keys.includes('configuredSecrets') ||
    !keys.includes('invocationSecrets')
  )
    return undefined;

  const configured = reflectiveObjectRead.ownEnumerableData(request, 'configuredSecrets');
  const invocation = reflectiveObjectRead.ownEnumerableData(request, 'invocationSecrets');
  if (!configured.valid || !invocation.valid) return undefined;
  return { configured: configured.value, invocation: invocation.value };
};

const readRequest = (
  request: unknown,
):
  | Readonly<{
      status: 'valid';
      configuredSecrets: readonly string[];
      invocationSecrets: readonly string[];
    }>
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'invalid' }> => {
  if (
    typeof request !== 'object' ||
    request === null ||
    !reflectiveObjectRead.isPlainObservedObject(request)
  )
    return { status: 'invalid' };
  const fields = readRequestFields(request);
  if (fields === undefined) return { status: 'invalid' };

  const configuredSecrets = readSecretList(fields.configured);
  const invocationSecrets = readSecretList(fields.invocation);
  if (configuredSecrets.status === 'invalid' || invocationSecrets.status === 'invalid')
    return { status: 'invalid' };
  if (configuredSecrets.status === 'empty' || invocationSecrets.status === 'empty')
    return { status: 'empty' };
  return {
    status: 'valid',
    configuredSecrets: configuredSecrets.values,
    invocationSecrets: invocationSecrets.values,
  };
};

export const registerSecrets = (request: SecretRegistrationRequest): SealedSecretRegistration => {
  try {
    const observed = readRequest(request);
    if (observed.status === 'invalid')
      return Object.freeze({ status: 'rejected', reason: 'invalid_request' });
    if (observed.status === 'empty')
      return Object.freeze({ status: 'rejected', reason: 'empty_secret_value' });

    const unique = new Set<string>();
    for (const secret of observed.configuredSecrets) unique.add(secret);
    for (const secret of observed.invocationSecrets) unique.add(secret);
    return Object.freeze({
      status: 'registered',
      secretValues: Object.freeze([...unique]),
    });
  } catch {
    return Object.freeze({ status: 'rejected', reason: 'invalid_request' });
  }
};
