import { expect, test } from 'vitest';

import { CompletedInvocations } from '../../../../src/application/manager/completed-invocations.js';
import type { RetainedInvocationRecord } from '../../../../src/application/manager/retained-invocation-record.js';
import type { NormalizedInvocationOutcome } from '../../../../src/runtime/execution/index.js';

const succeeded = (id: string): NormalizedInvocationOutcome =>
  Object.freeze({ status: 'succeeded', value: Object.freeze({ id }), evidence: Object.freeze({}) });

const record = (id: string): RetainedInvocationRecord =>
  Object.freeze({
    outcome: succeeded(id),
    pin: Object.freeze({
      agentId: 'agent',
      agentVersion: '1.0.0',
      definitionDigest: `digest-${id}`,
    }),
    acceptedAt: `2026-08-24T00:00:0${id === 'first' ? 1 : 2}.000Z`,
    startedAt: undefined,
    finishedAt: undefined,
    metadata: undefined,
    outputDirectory: `/outputs/${id}`,
  });

test('retains canonical completed records in FIFO completion order', () => {
  const completed = new CompletedInvocations(1);
  const first = record('first');
  const second = record('second');

  completed.commit('first', first);
  completed.commit('second', second);

  expect(completed.get('first')).toBeUndefined();
  expect(completed.get('second')?.outcome).toBe(second.outcome);
  expect(completed.entries()).toEqual([['second', second]]);
  expect(completed.has('first')).toBe(false);
  expect(completed.has('second')).toBe(true);
});
