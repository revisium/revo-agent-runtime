import { expect, test } from 'vitest';

import { recoverySessionSnapshots } from '../../../../../src/application/session/management/recovery-snapshots.js';
import type { ActiveAgentSessionSnapshot, AgentDescriptor } from '../../../../../src/index.js';

const definitionDigest = 'a'.repeat(64);
const agents: readonly AgentDescriptor[] = [
  {
    agent: { id: 'fake', version: '1' },
    capabilities: { cancellation: true, structuredResult: true, usage: false },
    definitionDigest,
    displayName: 'Fake',
  },
];

const valid = (): ActiveAgentSessionSnapshot => ({
  acceptedAt: '2026-09-05T00:00:00.000Z',
  incarnationId: 'inc_valid',
  pin: { agentId: 'fake', agentVersion: '1', definitionDigest },
  process: {
    fingerprint: `sha256:${'b'.repeat(64)}`,
    pid: 42,
    processGroupId: 42,
    startedAt: '2026-09-05T00:00:01.000Z',
  },
  sessionId: 'dlg_valid',
  state: 'idle',
});

const changed = (mutate: (value: Record<string, unknown>) => void): unknown => {
  const value = structuredClone(valid()) as unknown as Record<string, unknown>;
  mutate(value);
  return value;
};

test('accepts, copies, and freezes every persisted active session state', () => {
  const states = ['opening', 'idle', 'running', 'cancelling', 'hibernating', 'closing'] as const;

  for (const state of states) {
    const candidate = { ...valid(), state };
    const result = recoverySessionSnapshots([candidate], agents);
    expect(result).toEqual([candidate]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.[0]?.pin)).toBe(true);
    expect(Object.isFrozen(result?.[0]?.process)).toBe(true);
  }
});

test.each([
  ['undefined root', undefined],
  ['record root', {}],
  ['too many rows', Array.from({ length: 1_001 }, valid)],
  ['null row', [null]],
  ['array row', [[]]],
  ['missing row key', [changed((value) => delete value.state)]],
  ['extra row key', [changed((value) => (value.extra = true))]],
  [
    'symbol row key',
    [
      changed((value) => {
        Object.defineProperty(value, Symbol('extra'), { enumerable: true, value: true });
      }),
    ],
  ],
  [
    'non-enumerable row field',
    [
      changed((value) => {
        Object.defineProperty(value, 'state', { enumerable: false, value: 'idle' });
      }),
    ],
  ],
  [
    'accessor row field',
    [
      changed((value) => {
        Object.defineProperty(value, 'state', { enumerable: true, get: () => 'idle' });
      }),
    ],
  ],
  ['empty session id', [changed((value) => (value.sessionId = ''))]],
  ['nul session id', [changed((value) => (value.sessionId = 'dlg\0bad'))]],
  ['oversized session id', [changed((value) => (value.sessionId = 'x'.repeat(257)))]],
  ['non-string incarnation', [changed((value) => (value.incarnationId = 1))]],
  ['invalid accepted timestamp', [changed((value) => (value.acceptedAt = 'today'))]],
  ['non-string accepted timestamp', [changed((value) => (value.acceptedAt = 1))]],
  ['non-canonical accepted timestamp', [changed((value) => (value.acceptedAt = '2026-09-05'))]],
  ['unknown state', [changed((value) => (value.state = 'checkpointing'))]],
  ['null pin', [changed((value) => (value.pin = null))]],
  ['extra pin key', [changed((value) => ((value.pin as Record<string, unknown>).extra = true))]],
  ['empty agent id', [changed((value) => ((value.pin as Record<string, unknown>).agentId = ''))]],
  [
    'non-string agent version',
    [changed((value) => ((value.pin as Record<string, unknown>).agentVersion = 1))],
  ],
  [
    'non-string digest',
    [changed((value) => ((value.pin as Record<string, unknown>).definitionDigest = 1))],
  ],
  [
    'malformed digest',
    [
      changed(
        (value) => ((value.pin as Record<string, unknown>).definitionDigest = 'A'.repeat(64)),
      ),
    ],
  ],
  ['null process', [changed((value) => (value.process = null))]],
  [
    'extra process key',
    [changed((value) => ((value.process as Record<string, unknown>).extra = true))],
  ],
  ['non-number pid', [changed((value) => ((value.process as Record<string, unknown>).pid = '42'))]],
  [
    'unsafe pid',
    [
      changed(
        (value) => ((value.process as Record<string, unknown>).pid = Number.MAX_SAFE_INTEGER + 1),
      ),
    ],
  ],
  [
    'zero process group',
    [changed((value) => ((value.process as Record<string, unknown>).processGroupId = 0))],
  ],
  [
    'non-string fingerprint',
    [changed((value) => ((value.process as Record<string, unknown>).fingerprint = 1))],
  ],
  [
    'malformed fingerprint',
    [changed((value) => ((value.process as Record<string, unknown>).fingerprint = 'sha256:bad'))],
  ],
  [
    'invalid process timestamp',
    [changed((value) => ((value.process as Record<string, unknown>).startedAt = 'invalid'))],
  ],
  [
    'unknown agent pin',
    [changed((value) => ((value.pin as Record<string, unknown>).agentId = 'unknown'))],
  ],
] as const)('rejects hostile recovery snapshot: %s', (_label, value) => {
  expect(recoverySessionSnapshots(value, agents)).toBeUndefined();
});

test('rejects duplicate session/incarnation identities', () => {
  expect(recoverySessionSnapshots([valid(), valid()], agents)).toBeUndefined();
});

test('contains hostile reflection traps', () => {
  const hostile = new Proxy(valid(), {
    ownKeys: () => {
      throw new Error('trap');
    },
  });
  expect(recoverySessionSnapshots([hostile], agents)).toBeUndefined();
});
