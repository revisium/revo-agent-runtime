import { expect, test } from 'vitest';

import { InvocationQueries } from '../../../../src/application/manager/invocation-queries.js';
import { fixtureInvocationResult } from '../../../support/builders/execution-evidence.js';

test('ignores late lifecycle notifications that cannot belong to a tracked invocation', () => {
  const queries = new InvocationQueries(1);
  const invocationId = 'already-released';

  queries.markStarted(invocationId, '2026-08-30T00:00:00.000Z');
  queries.markCancelling(invocationId);
  queries.complete(
    invocationId,
    fixtureInvocationResult('/fixture/output/already-released'),
    '2026-08-30T00:00:01.000Z',
  );

  expect(queries.getInvocation(invocationId)).toBeUndefined();
  expect(queries.getResult(invocationId)).toEqual({ state: 'unknown' });
});
