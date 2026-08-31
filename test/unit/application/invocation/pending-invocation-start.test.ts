import { expect, test } from 'vitest';

import { PendingInvocationStart } from '../../../../src/application/manager/pending-invocation-start.js';
import { PendingOperations } from '../../../../src/application/manager/pending-operations.js';
import type { InvocationExecution } from '../../../../src/execution/invocation/executor.js';

const executionThatCountsCancellation = (onCancel: () => void): InvocationExecution => ({
  activate: () => undefined,
  admission: new Promise(() => undefined),
  cancel: () => {
    onCancel();
    return true;
  },
  completion: new Promise(() => undefined),
  drainage: new Promise(() => undefined),
  evidence: () => undefined,
});

test('cancels a pending start once when cancellation arrives before execution is bound', async () => {
  const controller = new AbortController();
  const operations = new PendingOperations();
  const pending = new PendingInvocationStart({ signal: controller.signal }, operations);
  let executionCancellations = 0;

  controller.abort();
  pending.bindExecution(
    executionThatCountsCancellation(() => {
      executionCancellations += 1;
    }),
  );
  pending.cancel();

  expect(executionCancellations).toBe(1);

  pending.finishPending();
  pending.finishPending();
  await expect(operations.quiesce()).resolves.toBeUndefined();
  expect(operations.size).toBe(0);
});

test('tracks cancellation and quiescence once for each manager-owned operation', async () => {
  const operations = new PendingOperations();
  let cancellations = 0;
  const operation = operations.track(() => {
    cancellations += 1;
  });
  const quiescence = operations.quiesce();

  operation.cancel();
  operation.cancel();
  expect(cancellations).toBe(1);

  operation.finish();
  operation.finish();
  await expect(quiescence).resolves.toBeUndefined();
  expect(operations.size).toBe(0);
});
