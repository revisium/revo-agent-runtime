import { expect, test } from 'vitest';

import { CompletedInvocations } from '../../../../src/application/manager/completed-invocations.js';
import type { NormalizedInvocationOutcome } from '../../../../src/runtime/execution/index.js';

const succeeded = (id: string): NormalizedInvocationOutcome =>
  Object.freeze({ status: 'succeeded', value: Object.freeze({ id }), evidence: Object.freeze({}) });

test('retains canonical completed outcomes in FIFO completion order', () => {
  const completed = new CompletedInvocations(1);
  const first = succeeded('first');
  const second = succeeded('second');

  completed.commit('first', first);
  completed.commit('second', second);

  expect(completed.get('first')).toBeUndefined();
  expect(completed.get('second')).toBe(second);
  expect(completed.has('first')).toBe(false);
  expect(completed.has('second')).toBe(true);
});
