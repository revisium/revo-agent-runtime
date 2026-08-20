import { expect, test } from 'vitest';

import * as runtimeExecution from '../../../../src/runtime/execution/index.js';
import {
  inspectOutputClaimGuard,
  type OutputClaimGuard,
  type OutputClaimResult,
} from '../../../../src/runtime/execution/index.js';
import {
  beginOutputClaim,
  createOutputClaimAttempt,
} from '../../../../src/runtime/execution/output-claim-attempt/index.js';
import { FakeInvocationClock } from '../../../support/execution/fake-clock.js';
import { FakeOutputClaimPort } from '../../../support/execution/fake-output-claim-port.js';

const claimInput = () => ({
  invocationId: 'claim-test',
  outputDirectory: '/outputs/claim-test',
});

const beginClaim = (attempt: ReturnType<typeof createOutputClaimAttempt>): void => {
  beginOutputClaim(attempt);
};

const createAttempt = (port: FakeOutputClaimPort) => {
  const clock = new FakeInvocationClock({ initialNowMs: 1_000 });
  const attempt = createOutputClaimAttempt({ ...claimInput(), clock, port });
  return { attempt, clock };
};

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const settled = async <Value>(promise: Promise<Value>): Promise<Value | undefined> => {
  let observed: Value | undefined;
  void promise.then((value) => {
    observed = value;
  });
  await flushPromises();
  return observed;
};

const expectNeverRejects = async (
  result: Promise<OutputClaimResult>,
  quiescence: Promise<unknown>,
): Promise<void> => {
  await expect(result).resolves.toBeDefined();
  await expect(quiescence).resolves.toBeDefined();
};

test('successful create before deadline fulfills quiescence no later than claimed settlement', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('created');
  const { attempt, clock } = createAttempt(port);
  const observed: string[] = [];
  void attempt.settlement.then(() => observed.push('settlement'));
  void attempt.quiescence.then(() => observed.push('quiescence'));

  beginClaim(attempt);
  await expect(attempt.settlement).resolves.toEqual({
    status: 'claimed',
    session: claimInput(),
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    syscallDispatched: true,
  });

  expect(observed).toEqual(['quiescence', 'settlement']);
  expect(clock.pendingActionCount()).toBe(0);
  await expectNeverRejects(attempt.settlement, attempt.quiescence);
});

test('leaf-exists before deadline fulfills quiescence no later than rejected settlement', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('leaf-exists');
  const { attempt } = createAttempt(port);
  const observed: string[] = [];
  void attempt.settlement.then(() => observed.push('settlement'));
  void attempt.quiescence.then(() => observed.push('quiescence'));

  beginClaim(attempt);

  await expect(attempt.settlement).resolves.toEqual({ status: 'rejected', reason: 'leaf_exists' });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    syscallDispatched: true,
  });
  expect(observed).toEqual(['quiescence', 'settlement']);
});

test('create failure before deadline fulfills quiescence no later than rejected settlement', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('create-failed');
  const { attempt } = createAttempt(port);

  beginClaim(attempt);

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'create_failed',
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    syscallDispatched: true,
  });
});

test('promise rejection before deadline is typed as create_failed and never rejects claim promises', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('reject');
  const { attempt } = createAttempt(port);

  beginClaim(attempt);

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'create_failed',
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    syscallDispatched: true,
  });
  await expectNeverRejects(attempt.settlement, attempt.quiescence);
});

test('cancellation observed before dispatch rejects with undispatched quiescence', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('created');
  const { attempt, clock } = createAttempt(port);

  attempt.requestCancellation();
  beginClaim(attempt);

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'cancelled_before_dispatch',
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    syscallDispatched: false,
  });
  expect(port.requests()).toEqual([]);
  expect(clock.pendingActionCount()).toBe(0);
});

test('begin is one-use while the first exclusive-create call is still pending', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('pending');
  const { attempt } = createAttempt(port);

  beginClaim(attempt);
  expect(() => beginClaim(attempt)).not.toThrow();

  expect(port.requests()).toHaveLength(1);
  expect(port.pendingClaimCount()).toBe(1);

  port.settlePendingCreated(1);
  await expect(attempt.settlement).resolves.toEqual({ status: 'claimed', session: claimInput() });
});

test('cancellation after dispatch does not reinterpret a successful claim', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('pending');
  const { attempt } = createAttempt(port);

  beginClaim(attempt);
  attempt.requestCancellation();
  port.settlePendingCreated(1);

  await expect(attempt.settlement).resolves.toEqual({ status: 'claimed', session: claimInput() });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    syscallDispatched: true,
  });
});

test('synchronous failure before dispatch is caught and settles without rejecting promises', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('throw-before-dispatch');
  const { attempt, clock } = createAttempt(port);

  expect(() => beginOutputClaim(attempt)).not.toThrow();

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'internal_before_dispatch',
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    syscallDispatched: false,
  });
  expect(clock.pendingActionCount()).toBe(0);
  await expectNeverRejects(attempt.settlement, attempt.quiescence);
});

test('synchronous failure after dispatch retains the identical guard for unknown claim state', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('throw-after-dispatch');
  const { attempt } = createAttempt(port);

  expect(() => beginOutputClaim(attempt)).not.toThrow();

  const result = await attempt.settlement;
  const quiescence = await attempt.quiescence;

  expect(result.status).toBe('uncertain');
  expect(result).toMatchObject({ status: 'uncertain', reason: 'claim_state_unknown' });
  expect(quiescence.status).toBe('retained');
  if (result.status !== 'uncertain' || quiescence.status !== 'retained') {
    throw new Error('Expected retained unknown claim state.');
  }
  expect(quiescence.guard).toBe(result.guard);
});

test('deadline retains the guard when the platform call never marks dispatch or settles', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('pending-without-dispatch');
  const { attempt, clock } = createAttempt(port);

  beginClaim(attempt);
  clock.advanceBy(10_000);
  const result = await settled(attempt.settlement);
  const quiescence = await settled(attempt.quiescence);

  expect(result).toMatchObject({ status: 'uncertain', reason: 'claim_timeout' });
  expect(quiescence).toMatchObject({ status: 'retained' });
  if (result?.status !== 'uncertain' || quiescence?.status !== 'retained') {
    throw new Error('Expected retained timeout for undispatched hanging claim.');
  }
  expect(quiescence.guard).toBe(result.guard);
  expect(inspectOutputClaimGuard(result.guard)).toEqual({
    status: 'unknown',
    reason: 'pending',
  });
  expect(clock.pendingActionCount()).toBe(0);
});

test('deadline winning after dispatch keeps late create reachable through the retained guard', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('pending');
  const { attempt, clock } = createAttempt(port);

  beginClaim(attempt);
  clock.advanceBy(10_000);
  const result = await attempt.settlement;
  const quiescence = await attempt.quiescence;

  expect(result.status).toBe('uncertain');
  expect(result).toMatchObject({ status: 'uncertain', reason: 'claim_timeout' });
  expect(quiescence.status).toBe('retained');
  if (result.status !== 'uncertain' || quiescence.status !== 'retained') {
    throw new Error('Expected retained timed-out claim.');
  }
  expect(quiescence.guard).toBe(result.guard);
  expect(exposedGuardFields(result.guard)).toEqual(['invocationId', 'outputDirectory']);

  expect(inspectOutputClaimGuard(result.guard)).toEqual({
    status: 'unknown',
    reason: 'pending',
  });

  port.settlePendingCreated(1);
  await flushPromises();

  const reconciliation = inspectOutputClaimGuard(result.guard);
  expect(reconciliation.status).toBe('claimed');
  if (reconciliation.status !== 'claimed') {
    throw new Error('Expected late claim reconciliation.');
  }
  expect(reconciliation.session).toEqual(claimInput());
  await expect(attempt.settlement).resolves.toBe(result);
  await expect(attempt.quiescence).resolves.toBe(quiescence);
});

test('late leaf-exists, create-failed, and unknown errors after timeout reconcile under the retained guard', async () => {
  const leafExistsPort = new FakeOutputClaimPort();
  leafExistsPort.enqueue('pending');
  const leafExists = createAttempt(leafExistsPort);
  beginClaim(leafExists.attempt);
  leafExists.clock.advanceBy(10_000);
  const leafExistsResult = await leafExists.attempt.settlement;
  leafExistsPort.settlePendingLeafExists(1);

  const createFailedPort = new FakeOutputClaimPort();
  createFailedPort.enqueue('pending');
  const createFailed = createAttempt(createFailedPort);
  beginClaim(createFailed.attempt);
  createFailed.clock.advanceBy(10_000);
  const createFailedResult = await createFailed.attempt.settlement;
  createFailedPort.settlePendingCreateFailed(1);

  await flushPromises();
  if (leafExistsResult.status !== 'uncertain') {
    throw new Error('Expected late leaf-exists retained guard.');
  }
  expect(inspectOutputClaimGuard(leafExistsResult.guard)).toEqual({ status: 'absent' });
  await expect(leafExists.attempt.settlement).resolves.toBe(leafExistsResult);
  const unknownFailurePort = new FakeOutputClaimPort();
  unknownFailurePort.enqueue('pending');
  const unknownFailure = createAttempt(unknownFailurePort);
  beginClaim(unknownFailure.attempt);
  unknownFailure.clock.advanceBy(10_000);
  const unknownFailureResult = await unknownFailure.attempt.settlement;
  unknownFailurePort.rejectPending(1);

  await flushPromises();
  if (createFailedResult.status !== 'uncertain' || unknownFailureResult.status !== 'uncertain') {
    throw new Error('Expected retained guards after timeout.');
  }
  expect(inspectOutputClaimGuard(createFailedResult.guard)).toEqual({ status: 'absent' });
  expect(inspectOutputClaimGuard(unknownFailureResult.guard)).toEqual({
    status: 'unknown',
    reason: 'unreconciled',
  });
  await expect(createFailed.attempt.settlement).resolves.toBe(createFailedResult);
  await expect(unknownFailure.attempt.settlement).resolves.toBe(unknownFailureResult);
});

test('public entrypoint cannot mint claim guards or claimed sessions', async () => {
  const port = new FakeOutputClaimPort();
  port.enqueue('created');
  const claimed = createAttempt(port);
  beginClaim(claimed.attempt);
  const claimedResult = await claimed.attempt.settlement;

  const timedOutPort = new FakeOutputClaimPort();
  timedOutPort.enqueue('pending');
  const timedOut = createAttempt(timedOutPort);
  beginClaim(timedOut.attempt);
  timedOut.clock.advanceBy(10_000);
  const timedOutResult = await timedOut.attempt.settlement;

  if (claimedResult.status !== 'claimed' || timedOutResult.status !== 'uncertain') {
    throw new Error('Expected claimed and retained claim results.');
  }
  expect(claimedResult.session).toEqual(claimInput());
  expect('OutputClaimGuard' in runtimeExecution).toBe(false);
  expect('ClaimedInvocationOutput' in runtimeExecution).toBe(false);
  expect('createOutputClaimAttempt' in runtimeExecution).toBe(false);
  expect('beginOutputClaim' in runtimeExecution).toBe(false);
  expect(inspectOutputClaimGuard(timedOutResult.guard)).toEqual({
    status: 'unknown',
    reason: 'pending',
  });
  expect(inspectOutputClaimGuard(claimInput())).toEqual({
    status: 'unknown',
    reason: 'unreconciled',
  });
});

test('factory allocates both promises and arms the private deadline synchronously before return', async () => {
  const port = new FakeOutputClaimPort();
  const clock = new FakeInvocationClock({ initialNowMs: 1_000 });

  const attempt = createOutputClaimAttempt({ ...claimInput(), clock, port });

  expect(attempt.invocationId).toBe('claim-test');
  expect(attempt.outputDirectory).toBe('/outputs/claim-test');
  expect(attempt.settlement).toBeInstanceOf(Promise);
  expect(attempt.quiescence).toBeInstanceOf(Promise);
  expect(clock.pendingActionCount()).toBe(1);
  expect(await settled(attempt.settlement)).toBeUndefined();
  expect(await settled(attempt.quiescence)).toBeUndefined();
});

const exposedGuardFields = (guard: OutputClaimGuard): readonly string[] =>
  Reflect.ownKeys(guard).map(String);
