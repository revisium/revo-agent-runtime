import type { ExecutionBinding } from './execution-binding.js';
import { reflectiveObjectRead } from './reflective-object-read.js';

const { isPlainObservedObject, ownEnumerableData } = reflectiveObjectRead;

const ownValue = (value: object, key: string): unknown => {
  const read = ownEnumerableData(value, key);
  return read.valid ? read.value : undefined;
};

const hasExactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
};

const optionalBindingKeys = Object.freeze(['protocolDriverId', 'permissionStrategyId', 'delivery']);
const fullBindingKeys = Object.freeze([
  'protocolDriverId',
  'resultParserId',
  'permissionStrategyId',
  'delivery',
]);

const asProtocolDriverId = (value: unknown): ExecutionBinding['protocolDriverId'] | undefined =>
  value === 'native/stdio-v1' || value === 'acp/v1' ? value : undefined;

const asResultParserId = (value: unknown): ExecutionBinding['resultParserId'] | undefined =>
  value === 'codex-jsonl/v1' || value === 'claude-stream-json/v1' ? value : undefined;

const asPermissionStrategyId = (
  value: unknown,
): ExecutionBinding['permissionStrategyId'] | undefined =>
  value === 'codex-cli/v1' || value === 'claude-cli/v1' || value === 'acp/v1' ? value : undefined;

const asPromptDelivery = (value: unknown): ExecutionBinding['delivery']['prompt'] | undefined =>
  value === 'argument' || value === 'stdin' || value === 'file' || value === 'protocol'
    ? value
    : undefined;

const asResultSchemaDelivery = (
  value: unknown,
): ExecutionBinding['delivery']['resultSchema'] | undefined =>
  value === 'argument' || value === 'file' || value === 'protocol' ? value : undefined;

const asResultDelivery = (value: unknown): ExecutionBinding['delivery']['result'] | undefined =>
  value === 'stdout' || value === 'protocol' ? value : undefined;

export const readExecutionBinding = (value: unknown): ExecutionBinding | undefined => {
  if (typeof value !== 'object' || value === null || !isPlainObservedObject(value))
    return undefined;
  const keys = Reflect.ownKeys(value);
  if (!(hasExactKeys(value, optionalBindingKeys) || hasExactKeys(value, fullBindingKeys)))
    return undefined;
  const protocolDriverId = asProtocolDriverId(ownValue(value, 'protocolDriverId'));
  const resultParserId = keys.includes('resultParserId')
    ? asResultParserId(ownValue(value, 'resultParserId'))
    : undefined;
  const permissionStrategyId = asPermissionStrategyId(ownValue(value, 'permissionStrategyId'));
  const deliveryRead = ownEnumerableData(value, 'delivery');
  if (
    protocolDriverId === undefined ||
    permissionStrategyId === undefined ||
    (keys.includes('resultParserId') && resultParserId === undefined) ||
    !deliveryRead.valid ||
    typeof deliveryRead.value !== 'object' ||
    deliveryRead.value === null ||
    !isPlainObservedObject(deliveryRead.value) ||
    !hasExactKeys(deliveryRead.value, ['prompt', 'resultSchema', 'result'])
  )
    return undefined;
  const prompt = asPromptDelivery(ownValue(deliveryRead.value, 'prompt'));
  const resultSchema = asResultSchemaDelivery(ownValue(deliveryRead.value, 'resultSchema'));
  const result = asResultDelivery(ownValue(deliveryRead.value, 'result'));
  if (prompt === undefined || resultSchema === undefined || result === undefined) return undefined;
  return Object.freeze({
    protocolDriverId,
    ...(resultParserId === undefined ? {} : { resultParserId }),
    permissionStrategyId,
    delivery: Object.freeze({ prompt, resultSchema, result }),
  });
};
