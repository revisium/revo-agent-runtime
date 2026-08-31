import type { ActiveInvocationSnapshot } from '../../contracts/manager.js';
import type { SealedAgentRegistry } from '../../definition/index.js';

const encoder = new TextEncoder();
const fingerprintPattern = /^sha256:[a-f0-9]{64}$/;
const digestPattern = /^[a-f0-9]{64}$/;

const exactRecord = (
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    return undefined;
  const record: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      return undefined;
    record[key] = descriptor.value;
  }
  return record;
};

const boundedText = (value: unknown, maximumBytes = 256): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.includes('\u0000') &&
  encoder.encode(value).byteLength <= maximumBytes;

const validIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};

const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const snapshotOne = (
  value: unknown,
  registry: SealedAgentRegistry,
): ActiveInvocationSnapshot | undefined => {
  const snapshot = exactRecord(value, ['invocationId', 'pin', 'process', 'state']);
  const pin = exactRecord(snapshot?.pin, ['agentId', 'agentVersion', 'definitionDigest']);
  const process = exactRecord(snapshot?.process, [
    'pid',
    'processGroupId',
    'fingerprint',
    'startedAt',
  ]);
  if (
    snapshot === undefined ||
    pin === undefined ||
    process === undefined ||
    !boundedText(snapshot.invocationId) ||
    (snapshot.state !== 'running' && snapshot.state !== 'cancelling') ||
    !boundedText(pin.agentId) ||
    !boundedText(pin.agentVersion) ||
    typeof pin.definitionDigest !== 'string' ||
    !digestPattern.test(pin.definitionDigest) ||
    !positiveSafeInteger(process.pid) ||
    !positiveSafeInteger(process.processGroupId) ||
    typeof process.fingerprint !== 'string' ||
    !fingerprintPattern.test(process.fingerprint) ||
    !validIsoTimestamp(process.startedAt)
  )
    return undefined;
  const definition = registry.get({ id: pin.agentId, version: pin.agentVersion });
  if (definition?.digest !== pin.definitionDigest) return undefined;
  return Object.freeze({
    invocationId: snapshot.invocationId,
    pin: Object.freeze({
      agentId: pin.agentId,
      agentVersion: pin.agentVersion,
      definitionDigest: pin.definitionDigest,
    }),
    process: Object.freeze({
      pid: process.pid,
      processGroupId: process.processGroupId,
      fingerprint: process.fingerprint,
      startedAt: process.startedAt,
    }),
    state: snapshot.state,
  });
};

export const recoverySnapshots = (
  value: unknown,
  registry: SealedAgentRegistry,
): readonly ActiveInvocationSnapshot[] | undefined => {
  try {
    if (!Array.isArray(value) || value.length > 1_000) return undefined;
    const snapshots: ActiveInvocationSnapshot[] = [];
    const invocationIds = new Set<string>();
    for (const input of value) {
      const snapshot = snapshotOne(input, registry);
      if (snapshot === undefined || invocationIds.has(snapshot.invocationId)) return undefined;
      invocationIds.add(snapshot.invocationId);
      snapshots.push(snapshot);
    }
    return Object.freeze(snapshots);
  } catch {
    return undefined;
  }
};
