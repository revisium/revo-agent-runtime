import { expect, test } from 'vitest';

import { CompletedInvocations } from '../../../../src/application/manager/completed-invocations.js';
import type { AgentInvocationResult } from '../../../../src/runtime/spec/index.js';

const record = (id: string): AgentInvocationResult =>
  Object.freeze({
    schemaVersion: 'agent-invocation-result/v1' as const,
    invocationId: id,
    pin: Object.freeze({
      agentId: 'agent',
      agentVersion: '1.0.0',
      definitionDigest: `digest-${id}`,
    }),
    launch: Object.freeze({ executable: '/agent', reportedVersion: '1.0.0' }),
    acceptedAt: `2026-08-24T00:00:0${id === 'first' ? 1 : 2}.000Z`,
    finishedAt: `2026-08-24T00:00:0${id === 'first' ? 1 : 2}.000Z`,
    durationMs: 1,
    exit: Object.freeze({ code: 0, signal: null }),
    files: Object.freeze({
      directory: `/outputs/${id}`,
      events: 'events.ndjson' as const,
      stdout: 'stdout.log' as const,
      stderr: 'stderr.log' as const,
      result: 'result.json' as const,
    }),
    status: 'succeeded' as const,
    value: Object.freeze({ id }),
  });

test('retains canonical completed results in FIFO completion order', () => {
  const completed = new CompletedInvocations(1);
  const first = record('first');
  const second = record('second');

  completed.commit('first', first);
  completed.commit('second', second);

  expect(completed.get('first')).toBeUndefined();
  expect(completed.get('second')).toBe(second);
  expect(completed.values()).toEqual([second]);
  expect(completed.has('first')).toBe(false);
  expect(completed.has('second')).toBe(true);
});
