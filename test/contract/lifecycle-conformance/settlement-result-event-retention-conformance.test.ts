import { expect, test } from 'vitest';

import { createLifecycleConformanceSubject } from '../../support/lifecycle-conformance/create-lifecycle-conformance-subject.js';
import { waitForLifecycleConformanceQuiescence } from '../../support/lifecycle-conformance/wait-for-lifecycle-conformance-quiescence.js';

test('waits for caller and deadline cancellation confirmation before terminal settlement', async () => {
  const caller = createLifecycleConformanceSubject();
  caller.output.enqueueTerminalResultRecording();
  caller.execution.enqueueStart('running');
  const callerAccepted = await caller.start(caller.createInput('caller-cancellation'));
  if (callerAccepted.status !== 'accepted')
    throw new Error('Expected caller cancellation acceptance.');
  await waitForLifecycleConformanceQuiescence();

  const callerCancellation = callerAccepted.lifecycle.requestCancellation();
  await waitForLifecycleConformanceQuiescence();
  caller.execution.settleCancellationRequest(1);
  await expect(callerCancellation).resolves.toBeUndefined();
  expect(callerAccepted.lifecycle.currentState()).toBe('cancelling');
  expect(caller.manager.getResult('caller-cancellation')).toEqual({ state: 'active' });
  caller.execution.confirmCancellation(1);
  await waitForLifecycleConformanceQuiescence();
  await expect(callerAccepted.handle.result()).resolves.toMatchObject({ status: 'cancelled' });

  const deadline = createLifecycleConformanceSubject();
  deadline.output.enqueueTerminalResultRecording();
  deadline.execution.enqueueStart('running');
  const deadlineAccepted = await deadline.start(
    deadline.createInput('deadline-cancellation', { wallClockTimeoutMs: 1_000 }),
  );
  if (deadlineAccepted.status !== 'accepted')
    throw new Error('Expected deadline cancellation acceptance.');
  await waitForLifecycleConformanceQuiescence();

  deadline.clock.advanceBy(1_000);
  await waitForLifecycleConformanceQuiescence();
  expect(deadlineAccepted.lifecycle.currentState()).toBe('cancelling');
  expect(deadline.manager.getResult('deadline-cancellation')).toEqual({ state: 'active' });
  deadline.execution.settleCancellationRequest(1);
  deadline.execution.confirmCancellation(1);
  await waitForLifecycleConformanceQuiescence();
  await expect(deadlineAccepted.handle.result()).resolves.toMatchObject({ status: 'timed_out' });
});

test('keeps natural completion as the first terminal result when cancellation races it', async () => {
  const subject = createLifecycleConformanceSubject();
  subject.output.enqueueTerminalResultRecording();
  subject.execution.enqueueStart('running');
  const accepted = await subject.start(subject.createInput('natural-wins'));
  if (accepted.status !== 'accepted') throw new Error('Expected natural completion acceptance.');
  await waitForLifecycleConformanceQuiescence();

  const cancellation = accepted.lifecycle.requestCancellation();
  await waitForLifecycleConformanceQuiescence();
  subject.execution.settleNaturalCompletion(1, new TextEncoder().encode('{"winner":"natural"}'));
  await expect(cancellation).rejects.toThrow(
    'Execution completed before cancellation request was accepted',
  );
  await waitForLifecycleConformanceQuiescence();

  await expect(accepted.handle.result()).resolves.toMatchObject({
    status: 'succeeded',
    value: { winner: 'natural' },
  });
  expect(subject.output.recordedTerminalResults()).toHaveLength(1);
});

test('keeps finalizing work out of completed lookup and terminal delivery until one release', async () => {
  const subject = createLifecycleConformanceSubject();
  subject.output.enqueuePendingTerminalResultRecording();
  subject.execution.enqueueStart('running');
  const events: unknown[] = [];
  subject.manager.subscribe({}, (event) => events.push(event));
  const accepted = await subject.start(subject.createInput('finalizing-release'));
  if (accepted.status !== 'accepted') throw new Error('Expected finalizing invocation acceptance.');
  await waitForLifecycleConformanceQuiescence();

  subject.execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
  await waitForLifecycleConformanceQuiescence();
  expect(accepted.lifecycle.currentState()).toBe('finalizing');
  expect(subject.manager.getResult('finalizing-release')).toEqual({ state: 'active' });
  expect(events).toEqual([]);
  await expect(subject.start(subject.createInput('finalizing-release'))).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  expect(
    subject.output.calls().filter((call) => call.type === 'record-terminal-result'),
  ).toHaveLength(1);

  subject.output.fulfilPendingTerminalResultRecording(1);
  await waitForLifecycleConformanceQuiescence();
  const result = await accepted.handle.result();
  expect(result).toMatchObject({ status: 'succeeded', value: { ok: true } });
  expect(subject.manager.getResult('finalizing-release')).toEqual({ state: 'completed', result });
  expect(events).toEqual([{ type: 'invocation.finished', invocationId: 'finalizing-release' }]);
  expect(
    subject.output.calls().filter((call) => call.type === 'record-terminal-result'),
  ).toHaveLength(1);
});

test.each([
  ['malformed-raw-response', new TextEncoder().encode('{'), {}],
  [
    'schema-mismatch',
    new TextEncoder().encode('{}'),
    {
      resultSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { requiredValue: { type: 'string' } },
        required: ['requiredValue'],
      },
    },
  ],
] as const)(
  'maps a failed terminal recording over a %s provisional failure without retrying',
  async (caseId, rawResponse, input) => {
    const subject = createLifecycleConformanceSubject();
    const events: unknown[] = [];
    subject.manager.subscribe({}, (event) => events.push(event));
    subject.output.enqueueTerminalResultRecording(new Error('write failed'));
    subject.execution.enqueueStart('running');
    const invocationId = `failed-terminal-recording-${caseId}`;
    const accepted = await subject.start(subject.createInput(invocationId, input));
    if (accepted.status !== 'accepted')
      throw new Error('Expected output failure invocation acceptance.');
    await waitForLifecycleConformanceQuiescence();

    subject.execution.settleNaturalCompletion(1, rawResponse);
    await waitForLifecycleConformanceQuiescence();

    const result = await accepted.handle.result();
    expect(result).toMatchObject({ status: 'failed' });
    expect(subject.manager.getResult(invocationId)).toEqual({ state: 'completed', result });
    expect(events).toEqual([{ type: 'invocation.finished', invocationId }]);
    expect(
      subject.output.calls().filter((call) => call.type === 'record-terminal-result'),
    ).toHaveLength(1);
    expect(subject.output.recordedTerminalResults()).toEqual([]);
  },
);

test('delivers one canonical result after lookup visibility and isolates listeners', async () => {
  const subject = createLifecycleConformanceSubject({ maxCompletedInvocations: 3 });
  subject.output.enqueueTerminalResultRecording();
  subject.output.enqueueTerminalResultRecording();
  subject.execution.enqueueStart('running');
  subject.execution.enqueueStart('running');
  let throwingCalls = 0;
  let handleResolved = false;
  let waiterResolved = false;
  const delivered: unknown[] = [];
  const throwing = subject.manager.subscribe({}, () => {
    throwingCalls += 1;
    throw new Error('listener failure');
  });
  const matching = subject.manager.subscribe({ invocationId: 'delivered' }, (event) => {
    const lookup = subject.manager.getResult(event.invocationId);
    expect(lookup.state).toBe('completed');
    if (lookup.state !== 'completed')
      throw new Error('Expected completed lookup before terminal delivery.');
    expect('result' in event).toBe(false);
    expect(handleResolved).toBe(false);
    expect(waiterResolved).toBe(false);
    delivered.push(lookup.result);
  });
  const filtered = subject.manager.subscribe({ invocationId: 'other' }, (event) =>
    delivered.push(event),
  );
  const overCapacity = subject.manager.subscribe({}, () => undefined);
  expect(throwing.state).toBe('subscribed');
  expect(matching.state).toBe('subscribed');
  expect(filtered.state).toBe('subscribed');
  expect(overCapacity.state).toBe('subscribed');

  const accepted = await subject.start(subject.createInput('delivered'));
  if (accepted.status !== 'accepted') throw new Error('Expected listener invocation acceptance.');
  const handle = accepted.handle.result().then((result) => {
    handleResolved = true;
    return result;
  });
  const waiter = subject.manager.waitForResult('delivered').then((result) => {
    waiterResolved = true;
    return result;
  });
  await waitForLifecycleConformanceQuiescence();
  subject.execution.settleNaturalCompletion(1, new TextEncoder().encode('{"id":"delivered"}'));
  await waitForLifecycleConformanceQuiescence();

  const result = await handle;
  expect(await waiter).toBe(result);
  expect(delivered).toEqual([result]);
  expect(throwingCalls).toBe(1);
  if (filtered.state === 'subscribed') filtered.dispose();
  const lateEvents: unknown[] = [];
  const late = subject.manager.subscribe({}, (event) => lateEvents.push(event));
  expect(late.state).toBe('subscribed');
  expect(lateEvents).toEqual([]);

  const second = await subject.start(subject.createInput('later'));
  if (second.status !== 'accepted') throw new Error('Expected later invocation acceptance.');
  await waitForLifecycleConformanceQuiescence();
  subject.execution.settleNaturalCompletion(2, new TextEncoder().encode('{"id":"later"}'));
  await waitForLifecycleConformanceQuiescence();
  await second.handle.result();
  expect(lateEvents).toEqual([{ type: 'invocation.finished', invocationId: 'later' }]);
  expect(throwingCalls).toBe(1);
});

test('reaccepts the same literal id only after completed FIFO eviction while active ids remain protected', async () => {
  const subject = createLifecycleConformanceSubject({ maxCompletedInvocations: 2 });
  subject.output.enqueueTerminalResultRecording();
  subject.output.enqueueTerminalResultRecording();
  subject.output.enqueueTerminalResultRecording();
  subject.output.enqueueTerminalResultRecording();
  subject.output.enqueueTerminalResultRecording();
  subject.execution.enqueueStart('running');
  subject.execution.enqueueStart('running');
  subject.execution.enqueueStart('running');
  subject.execution.enqueueStart('running');
  subject.execution.enqueueStart('running');

  const reusable = await subject.start(subject.createInput('reusable-id'));
  if (reusable.status !== 'accepted') throw new Error('Expected reusable id acceptance.');
  await waitForLifecycleConformanceQuiescence();
  subject.execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await waitForLifecycleConformanceQuiescence();
  await expect(subject.start(subject.createInput('reusable-id'))).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  expect(subject.manager.getResult('reusable-id').state).toBe('completed');

  const active = await subject.start(subject.createInput('active-id'));
  if (active.status !== 'accepted') throw new Error('Expected active id acceptance.');
  const laterOne = await subject.start(subject.createInput('later-one'));
  if (laterOne.status !== 'accepted') throw new Error('Expected first later id acceptance.');
  await waitForLifecycleConformanceQuiescence();
  subject.execution.settleNaturalCompletion(3, new TextEncoder().encode('{}'));
  await waitForLifecycleConformanceQuiescence();
  expect(subject.manager.getResult('reusable-id').state).toBe('completed');

  const laterTwo = await subject.start(subject.createInput('later-two'));
  if (laterTwo.status !== 'accepted') throw new Error('Expected second later id acceptance.');
  await waitForLifecycleConformanceQuiescence();
  subject.execution.settleNaturalCompletion(4, new TextEncoder().encode('{}'));
  await waitForLifecycleConformanceQuiescence();
  expect(subject.manager.getResult('reusable-id')).toEqual({ state: 'unknown' });
  await expect(subject.start(subject.createInput('active-id'))).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });

  const reaccepted = await subject.start(subject.createInput('reusable-id'));
  if (reaccepted.status !== 'accepted')
    throw new Error('Expected FIFO-evicted reusable id acceptance.');
  await waitForLifecycleConformanceQuiescence();
  subject.execution.settleNaturalCompletion(5, new TextEncoder().encode('{}'));
  subject.execution.settleNaturalCompletion(2, new TextEncoder().encode('{}'));
  await waitForLifecycleConformanceQuiescence();
  await expect(reusable.handle.result()).resolves.toMatchObject({ status: 'succeeded', value: {} });
  await expect(laterOne.handle.result()).resolves.toMatchObject({ status: 'succeeded', value: {} });
  await expect(laterTwo.handle.result()).resolves.toMatchObject({ status: 'succeeded', value: {} });
  await expect(reaccepted.handle.result()).resolves.toMatchObject({
    status: 'succeeded',
    value: {},
  });
  await expect(active.handle.result()).resolves.toMatchObject({ status: 'succeeded', value: {} });
});
