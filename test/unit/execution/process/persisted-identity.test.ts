import { expect, test } from 'vitest';

import { snapshotProcessIdentity } from '../../../../src/execution/process/identity.js';

const evidence = {
  pid: 42,
  fingerprint: `sha256:${'a'.repeat(64)}`,
  startedAt: '2026-01-01T00:00:00.000Z',
};
const legacy = { ...evidence, processGroupId: 42 };
const windows = {
  ...evidence,
  version: 2,
  platform: 'win32',
  jobName: 'revo-12345678-1234-1234-1234-123456789abc',
};

test.each([
  ['legacy Linux', legacy],
  ['versioned Linux', { ...legacy, version: 2, platform: 'linux' }],
  ['versioned macOS', { ...legacy, version: 2, platform: 'darwin' }],
  ['Windows Job', windows],
] as const)(
  'copies and freezes %s identity evidence without changing its format',
  (_label, value) => {
    const candidate = { ...value };
    const snapshot = snapshotProcessIdentity(candidate);

    expect(snapshot).toEqual(value);
    expect(snapshot).not.toBe(candidate);
    expect(Object.isFrozen(snapshot)).toBe(true);
    candidate.pid = 99;
    expect(snapshot?.pid).toBe(42);
  },
);

test.each([
  ['null identity', null],
  ['array identity', []],
  ['missing evidence', {}],
  ['text PID', { ...legacy, pid: '42' }],
  ['zero PID', { ...legacy, pid: 0 }],
  ['unsafe PID', { ...legacy, pid: Number.MAX_SAFE_INTEGER + 1 }],
  ['zero process group', { ...legacy, processGroupId: 0 }],
  ['fractional process group', { ...legacy, version: 2, platform: 'darwin', processGroupId: 1.5 }],
  ['non-string fingerprint', { ...legacy, fingerprint: 42 }],
  ['malformed fingerprint', { ...legacy, fingerprint: 'sha256:unverified' }],
  ['non-string timestamp', { ...legacy, startedAt: 42 }],
  ['invalid timestamp', { ...legacy, startedAt: 'never' }],
  ['ambiguous timestamp', { ...legacy, startedAt: '2026-01-01' }],
  ['unexpected field', { ...legacy, extra: true }],
  ['unknown version', { ...legacy, version: 3, platform: 'linux' }],
  ['unknown platform', { ...legacy, version: 2, platform: 'unknown' }],
  ['unversioned platform', { ...legacy, platform: 'linux' }],
  ['missing Windows Job', { ...legacy, version: 2, platform: 'win32' }],
  ['foreign Job name', { ...windows, jobName: 'an-unowned-job' }],
  ['non-string Job name', { ...windows, jobName: 42 }],
  ['Windows process group', { ...windows, processGroupId: 42 }],
] as const)('rejects %s', (_label, value) => {
  expect(snapshotProcessIdentity(value)).toBeUndefined();
});

test('rejects an identity accessor without evaluating it', () => {
  let reads = 0;
  const candidate = {
    ...legacy,
    get version() {
      reads += 1;
      return 2;
    },
  };

  expect(snapshotProcessIdentity(candidate)).toBeUndefined();
  expect(reads).toBe(0);
});

test('rejects an own __proto__ field without evaluating getters on its value', () => {
  let reads = 0;
  const prototype = {
    get version() {
      reads += 1;
      return undefined;
    },
  };
  const candidate = Object.defineProperty({ ...legacy }, '__proto__', {
    enumerable: true,
    value: prototype,
  });

  expect(snapshotProcessIdentity(candidate)).toBeUndefined();
  expect(reads).toBe(0);
});

test('rejects identity evidence supplied only by a prototype', () => {
  const candidate = Object.create(evidence) as Record<string, unknown>;
  candidate.processGroupId = 42;

  expect(snapshotProcessIdentity(candidate)).toBeUndefined();
});

test.each([
  [
    'symbol field',
    () => Object.defineProperty({ ...legacy }, Symbol('extra'), { enumerable: true, value: true }),
  ],
  [
    'non-enumerable evidence',
    () => Object.defineProperty({ ...legacy }, 'pid', { enumerable: false }),
  ],
  [
    'disappearing evidence',
    () =>
      new Proxy(
        { ...legacy },
        {
          getOwnPropertyDescriptor: (target, key) =>
            key === 'pid' ? undefined : Reflect.getOwnPropertyDescriptor(target, key),
        },
      ),
  ],
] as const)('rejects an identity with %s', (_label, candidate) => {
  expect(snapshotProcessIdentity(candidate())).toBeUndefined();
});
