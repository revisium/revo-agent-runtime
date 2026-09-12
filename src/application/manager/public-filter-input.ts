import type { AgentRef } from '../../contracts/agent-definition.js';

export type DataProperty =
  | { readonly status: 'absent' }
  | { readonly status: 'invalid' }
  | { readonly status: 'present'; readonly value: unknown };

export const readDataProperty = (value: object, key: string): DataProperty => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return { status: 'absent' };
  return 'value' in descriptor
    ? { status: 'present', value: descriptor.value }
    : { status: 'invalid' };
};

export const readExactAgentRef = (value: unknown): AgentRef | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    !keys.includes('id') ||
    !keys.includes('version') ||
    !keys.includes('installationId')
  )
    return undefined;
  const id = readDataProperty(value, 'id');
  const version = readDataProperty(value, 'version');
  const installationId = readDataProperty(value, 'installationId');
  return id.status === 'present' &&
    version.status === 'present' &&
    installationId.status === 'present' &&
    typeof id.value === 'string' &&
    typeof version.value === 'string' &&
    typeof installationId.value === 'string'
    ? Object.freeze({
        id: id.value,
        version: version.value,
        installationId: installationId.value,
      })
    : undefined;
};

export const readClosedArray = <Value extends string>(
  value: unknown,
  isValue: (item: unknown) => item is Value,
): readonly Value[] | undefined => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.at(-1) !== 'length') return undefined;
  const owned: Value[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = readDataProperty(value, String(index));
    if (item.status !== 'present' || !isValue(item.value)) return undefined;
    owned.push(item.value);
  }
  return Object.freeze(owned);
};
