import type { ProcessIdentity } from './contracts.js';

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Copy persisted data without executing accessors or accepting unknown formats. */
export const snapshotProcessIdentity = (value: unknown): ProcessIdentity | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      ![
        'pid',
        'fingerprint',
        'startedAt',
        'processGroupId',
        'version',
        'platform',
        'jobName',
      ].includes(key) ||
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    )
      return undefined;
    record[key] = descriptor.value;
  }
  const { pid, fingerprint, startedAt } = record;
  if (
    !positiveInteger(pid) ||
    typeof fingerprint !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(fingerprint) ||
    typeof startedAt !== 'string'
  )
    return undefined;
  const timestamp = Date.parse(startedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== startedAt)
    return undefined;
  const evidence = { pid, fingerprint, startedAt };
  const keys = ['pid', 'fingerprint', 'startedAt'];
  const exactKeys = (...extra: string[]): boolean =>
    Reflect.ownKeys(record).every((key) => [...keys, ...extra].includes(String(key))) &&
    Reflect.ownKeys(record).length === keys.length + extra.length;
  if (
    record.version === undefined &&
    exactKeys('processGroupId') &&
    positiveInteger(record.processGroupId)
  ) {
    return Object.freeze({ ...evidence, processGroupId: record.processGroupId });
  }
  if (record.version !== 2) return undefined;
  if (
    (record.platform === 'linux' || record.platform === 'darwin') &&
    exactKeys('version', 'platform', 'processGroupId') &&
    positiveInteger(record.processGroupId)
  ) {
    return Object.freeze({
      ...evidence,
      version: 2,
      platform: record.platform,
      processGroupId: record.processGroupId,
    });
  }
  if (
    record.platform === 'win32' &&
    exactKeys('version', 'platform', 'jobName') &&
    typeof record.jobName === 'string' &&
    /^revo-[a-f0-9-]{36}$/u.test(record.jobName)
  ) {
    return Object.freeze({ ...evidence, version: 2, platform: 'win32', jobName: record.jobName });
  }
  return undefined;
};
