import { createHash } from 'node:crypto';

import type { ExecutionBinding } from '../execution-binding.js';
import type { OutputPreparationFileSlot } from '../output-preparation-attempt/output-preparation-file-slot.js';
import type { OutputResourcePlan } from '../output-resource-plan.js';
import type { PreparedInvocationPayloads } from '../payload-preparation/index.js';
import { reflectiveObjectRead } from '../reflective-object-read.js';
import type { PreparedInvocationMaterial } from './prepared-invocation-material.js';
import { PreparedInvocation } from './prepared-invocation.js';

const { isPlainObservedObject, ownEnumerableData } = reflectiveObjectRead;

type PreparedPayloadFile = PreparedInvocationPayloads['files'][number];

const sha256Hex = (bytes: Uint8Array): string =>
  // Keep file-local for this slice; extract when section 10 recomputes the same digest in the finalizer domain.
  createHash('sha256').update(bytes).digest('hex');

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const ownValue = (value: object, key: string): unknown => {
  const read = ownEnumerableData(value, key);
  return read.valid ? read.value : undefined;
};

const hasOwnEnumerableString = (value: object, key: string): string | undefined => {
  const valueRead = ownValue(value, key);
  return nonEmptyString(valueRead) ? valueRead : undefined;
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

const readBinding = (value: unknown): ExecutionBinding | undefined => {
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

const expectedPath = (plan: OutputResourcePlan, slot: OutputPreparationFileSlot['slot']): string =>
  `${plan.outputDirectory}/.scratch/${slot === 'prompt' ? 'prompt.txt' : 'result-schema.json'}`;

const slotFromKind = (kind: PreparedPayloadFile['kind']): OutputPreparationFileSlot['slot'] =>
  kind === 'prompt' ? 'prompt' : 'result-schema';

const requiredSlotPresent = (
  files: readonly OutputPreparationFileSlot[],
  slot: OutputPreparationFileSlot['slot'],
  required: boolean,
): boolean => files.some((file) => file.slot === slot) === required;

const deriveFileSlots = (
  payloads: PreparedInvocationPayloads,
  plan: OutputResourcePlan,
): readonly OutputPreparationFileSlot[] | undefined => {
  const seen = new Set<OutputPreparationFileSlot['slot']>();
  const files: OutputPreparationFileSlot[] = [];
  for (const file of payloads.files) {
    const slot = slotFromKind(file.kind);
    if (seen.has(slot) || file.path !== expectedPath(plan, slot)) return undefined;
    seen.add(slot);
    const copied = new Uint8Array(file.bytes);
    files.push(
      Object.freeze({
        slot,
        path: file.path,
        bytes: copied,
        expectedByteLength: copied.byteLength,
        expectedSha256: sha256Hex(copied),
      }),
    );
  }
  if (!requiredSlotPresent(files, 'prompt', plan.needsPromptFile)) return undefined;
  if (!requiredSlotPresent(files, 'result-schema', plan.needsResultSchemaFile)) return undefined;
  return Object.freeze(files);
};

const hasValidStrings = (material: PreparedInvocationMaterial): boolean =>
  typeof material.pin === 'object' &&
  material.pin !== null &&
  hasOwnEnumerableString(material.pin, 'agentId') !== undefined &&
  hasOwnEnumerableString(material.pin, 'agentVersion') !== undefined &&
  hasOwnEnumerableString(material.pin, 'definitionDigest') !== undefined &&
  nonEmptyString(material.workspaceDirectory) &&
  nonEmptyString(material.reportedVersion) &&
  nonEmptyString(material.outputResourcePlan.invocationId) &&
  nonEmptyString(material.outputResourcePlan.outputDirectory);

const isBindingConsistentWithPlan = (
  binding: ExecutionBinding,
  plan: OutputResourcePlan,
): boolean =>
  // Defense-in-depth: lifecycle-manager createOutputAdmissionRequest already establishes this invariant elsewhere.
  (binding.delivery.prompt === 'file') === plan.needsPromptFile &&
  (binding.delivery.resultSchema === 'file') === plan.needsResultSchemaFile;

export const createPreparedInvocation = (
  material: PreparedInvocationMaterial,
): PreparedInvocation | undefined => {
  if (!hasValidStrings(material)) return undefined;
  const binding = readBinding(material.binding);
  if (binding === undefined || !isBindingConsistentWithPlan(binding, material.outputResourcePlan))
    return undefined;
  const outputPreparation = deriveFileSlots(material.preparedPayloads, material.outputResourcePlan);
  if (outputPreparation === undefined) return undefined;
  return PreparedInvocation.create({
    invocationId: material.outputResourcePlan.invocationId,
    pin: Object.freeze({ ...material.pin }),
    workspaceDirectory: material.workspaceDirectory,
    outputDirectory: material.outputResourcePlan.outputDirectory,
    reportedVersion: material.reportedVersion,
    binding,
    outputPreparation,
  });
};
