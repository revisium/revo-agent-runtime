import { expect, test } from 'vitest';

import { createLifecycleConformanceSubject } from '../../support/lifecycle-conformance/create-lifecycle-conformance-subject.js';
import { waitForLifecycleConformanceQuiescence } from '../../support/lifecycle-conformance/wait-for-lifecycle-conformance-quiescence.js';

const cancellationCompletion = (
  outcome:
    | Readonly<{ status: 'committed'; completion: Promise<void> }>
    | Readonly<{ status: 'too_late' }>,
): Promise<void> => {
  expect(outcome.status).toBe('committed');
  if (outcome.status !== 'committed') throw new Error('Expected committed cancellation.');
  return outcome.completion;
};

test('rejects invalid preflight inputs without accepting an invocation', async () => {
  const invalidRequest = await createLifecycleConformanceSubject();
  const invalidRequestEvents: unknown[] = [];
  invalidRequest.manager.subscribe({}, (event) => invalidRequestEvents.push(event));
  await expect(invalidRequest.start(invalidRequest.createInput(''))).resolves.toEqual({
    status: 'rejected',
    reason: 'invocation_invalid',
  });
  expect(invalidRequest.output.calls()).toEqual([]);
  expect(invalidRequest.execution.calls()).toEqual([]);
  expect(invalidRequest.manager.getResult('')).toEqual({ state: 'unknown' });
  expect(invalidRequestEvents).toEqual([]);

  const invalidSchema = await createLifecycleConformanceSubject();
  const invalidSchemaEvents: unknown[] = [];
  invalidSchema.manager.subscribe({}, (event) => invalidSchemaEvents.push(event));
  await expect(
    invalidSchema.start(
      invalidSchema.createInput('invalid-schema', {
        resultSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', format: 'email' },
      }),
    ),
  ).resolves.toMatchObject({ status: 'rejected', reason: 'result_schema_invalid' });
  expect(invalidSchema.output.calls()).toEqual([]);
  expect(invalidSchema.execution.calls()).toEqual([]);
  expect(invalidSchema.manager.getResult('invalid-schema')).toEqual({ state: 'unknown' });
  expect(invalidSchemaEvents).toEqual([]);

  const unavailableOutput = await createLifecycleConformanceSubject();
  const unavailableOutputEvents: unknown[] = [];
  unavailableOutput.manager.subscribe({}, (event) => unavailableOutputEvents.push(event));
  unavailableOutput.outputPreparation.enqueue('scratch-create-failed');
  await expect(
    unavailableOutput.start(unavailableOutput.createInput('output-unavailable')),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'scratch_failed',
  });
  expect(unavailableOutput.execution.calls()).toEqual([]);
  expect(unavailableOutput.manager.getResult('output-unavailable')).toEqual({ state: 'unknown' });
  expect(unavailableOutputEvents).toEqual([]);
});

test('accepts only one concurrent invocation and snapshots caller-owned input', async () => {
  const subject = await createLifecycleConformanceSubject();
  const metadata = { nested: { state: 'accepted' } };
  subject.output.enqueueTerminalResultRecording();
  subject.execution.enqueueStart('running');
  const input = subject.createInput('same-id', { metadata });

  const admissions = await Promise.all([subject.start(input), subject.start(input)]);
  const accepted = admissions.find((admission) => admission.status === 'accepted');
  const rejected = admissions.find((admission) => admission.status === 'rejected');
  expect(accepted?.status).toBe('accepted');
  expect(rejected).toEqual({ status: 'rejected', reason: 'invocation_duplicate' });
  expect(subject.execution.calls()).toEqual([{ type: 'start' }]);

  metadata.nested.state = 'mutated';
  expect(subject.execution.startedSnapshots()[0]?.metadata).toEqual({
    nested: { state: 'accepted' },
  });
  await waitForLifecycleConformanceQuiescence();
  subject.execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await waitForLifecycleConformanceQuiescence();
  if (accepted?.status !== 'accepted')
    throw new Error('Expected the concurrent invocation to be accepted.');
  await expect(accepted.handle.result()).resolves.toMatchObject({ status: 'succeeded', value: {} });
});

test('cancels one accepted invocation exactly once after spawn confirmation', async () => {
  const subject = await createLifecycleConformanceSubject();
  subject.output.enqueueTerminalResultRecording();
  subject.execution.enqueuePendingStart();

  const start = subject.start(subject.createInput('pending-cancellation'));
  await waitForLifecycleConformanceQuiescence();
  subject.execution.fulfilPendingStart(1);
  const accepted = await start;
  if (accepted.status !== 'accepted') throw new Error('Expected pending invocation acceptance.');
  const cancellation = accepted.lifecycle.requestCancellation();
  expect(accepted.lifecycle.currentState()).toBe('cancelling');
  expect(subject.manager.getResult('pending-cancellation')).toMatchObject({
    state: 'running',
    invocation: { status: 'cancelling' },
  });
  expect(subject.output.recordedTerminalResults()).toEqual([]);

  await waitForLifecycleConformanceQuiescence();
  expect(subject.execution.calls()).toEqual([
    { type: 'start' },
    { type: 'request-cancellation', executionId: 1 },
  ]);
  subject.execution.settleCancellationRequest(1);
  await expect(cancellationCompletion(cancellation)).resolves.toBeUndefined();
  expect(subject.manager.getResult('pending-cancellation')).toMatchObject({
    state: 'running',
    invocation: { status: 'cancelling' },
  });
  await expect(subject.start(subject.createInput('pending-cancellation'))).resolves.toEqual({
    status: 'rejected',
    reason: 'invocation_duplicate',
  });

  subject.execution.confirmCancellation(1);
  await waitForLifecycleConformanceQuiescence();
  const result = await accepted.handle.result();
  expect(result).toMatchObject({ status: 'cancelled' });
  expect(subject.output.recordedTerminalResults()).toMatchObject([{ status: 'cancelled' }]);
  expect(subject.execution.calls()).toEqual([
    { type: 'start' },
    { type: 'request-cancellation', executionId: 1 },
  ]);
});
