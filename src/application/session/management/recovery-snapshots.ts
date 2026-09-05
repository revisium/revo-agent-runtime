import type { AgentDescriptor } from '../../../contracts/manager/core.js';
import type { ActiveAgentSessionSnapshot } from '../../../contracts/session/persistence/active-state.js';

const encoder = new TextEncoder();
const digestPattern = /^[a-f0-9]{64}$/u;
const fingerprintPattern = /^sha256:[a-f0-9]{64}$/u;
const sessionState = (value: unknown): value is ActiveAgentSessionSnapshot['state'] =>
  value === 'opening' ||
  value === 'idle' ||
  value === 'running' ||
  value === 'cancelling' ||
  value === 'hibernating' ||
  value === 'closing';

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

const boundedText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.includes('\u0000') &&
  encoder.encode(value).byteLength <= 256;

const validTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const parseSnapshot = (
  value: unknown,
  agents: readonly AgentDescriptor[],
): ActiveAgentSessionSnapshot | undefined => {
  const snapshot = exactRecord(value, [
    'acceptedAt',
    'incarnationId',
    'pin',
    'process',
    'sessionId',
    'state',
  ]);
  const pin = exactRecord(snapshot?.pin, ['agentId', 'agentVersion', 'definitionDigest']);
  const process = exactRecord(snapshot?.process, [
    'fingerprint',
    'pid',
    'processGroupId',
    'startedAt',
  ]);
  if (
    snapshot === undefined ||
    pin === undefined ||
    process === undefined ||
    !boundedText(snapshot.sessionId) ||
    !boundedText(snapshot.incarnationId) ||
    !validTimestamp(snapshot.acceptedAt) ||
    !sessionState(snapshot.state) ||
    !boundedText(pin.agentId) ||
    !boundedText(pin.agentVersion) ||
    typeof pin.definitionDigest !== 'string' ||
    !digestPattern.test(pin.definitionDigest) ||
    !positiveSafeInteger(process.pid) ||
    !positiveSafeInteger(process.processGroupId) ||
    typeof process.fingerprint !== 'string' ||
    !fingerprintPattern.test(process.fingerprint) ||
    !validTimestamp(process.startedAt)
  )
    return undefined;
  if (
    !agents.some(
      ({ agent, definitionDigest }) =>
        agent.id === pin.agentId &&
        agent.version === pin.agentVersion &&
        definitionDigest === pin.definitionDigest,
    )
  )
    return undefined;
  return Object.freeze({
    acceptedAt: snapshot.acceptedAt,
    incarnationId: snapshot.incarnationId,
    pin: Object.freeze({
      agentId: pin.agentId,
      agentVersion: pin.agentVersion,
      definitionDigest: pin.definitionDigest,
    }),
    process: Object.freeze({
      fingerprint: process.fingerprint,
      pid: process.pid,
      processGroupId: process.processGroupId,
      startedAt: process.startedAt,
    }),
    sessionId: snapshot.sessionId,
    state: snapshot.state,
  });
};

export const recoverySessionSnapshots = (
  value: unknown,
  agents: readonly AgentDescriptor[],
): readonly ActiveAgentSessionSnapshot[] | undefined => {
  try {
    if (!Array.isArray(value) || value.length > 1_000) return undefined;
    const snapshots: ActiveAgentSessionSnapshot[] = [];
    const identities = new Set<string>();
    for (const candidate of value) {
      const snapshot = parseSnapshot(candidate, agents);
      if (snapshot === undefined) return undefined;
      const identity = `${snapshot.sessionId}\u0000${snapshot.incarnationId}`;
      if (identities.has(identity)) return undefined;
      identities.add(identity);
      snapshots.push(snapshot);
    }
    return Object.freeze(snapshots);
  } catch {
    return undefined;
  }
};
