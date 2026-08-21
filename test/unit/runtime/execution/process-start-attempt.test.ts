import { expect, test } from 'vitest';

import {
  beginProcessStart,
  createProcessStartAttempt,
  getProcessStartInvocationToken,
  PausedProcessIo,
  SpawnAcceptedProcess,
  type ProcessStartResult,
} from '../../../../src/runtime/execution/index.js';
import { FakeProcessStartPort } from '../../../support/execution/fake-process-start-port.js';

const createAttempt = (port: FakeProcessStartPort) => {
  const attempt = createProcessStartAttempt({ invocationId: 'process-start-test' });
  return { attempt, port };
};

const beginStart = (
  attempt: ReturnType<typeof createProcessStartAttempt>,
  port: FakeProcessStartPort,
): void => {
  beginProcessStart(attempt, () => port.beginStart(attempt));
};

const expectStillPending = async (promise: Promise<unknown>): Promise<void> => {
  await expect(
    Promise.race([
      promise.then(() => 'resolved'),
      new Promise((resolve) => {
        setImmediate(() => resolve('still-pending'));
      }),
    ]),
  ).resolves.toBe('still-pending');
};

const expectNeverRejects = async (
  result: Promise<ProcessStartResult>,
  quiescence: Promise<unknown>,
): Promise<void> => {
  await expect(result).resolves.toBeDefined();
  await expect(quiescence).resolves.toBeDefined();
};

test('accepted spawn settles with authentic process and paused I/O carriers bound to one token', async () => {
  const port = new FakeProcessStartPort();
  port.enqueue('accepted');
  const { attempt } = createAttempt(port);

  beginStart(attempt, port);
  const result = await attempt.settlement;

  expect(result.status).toBe('spawn_accepted');
  if (result.status !== 'spawn_accepted') throw new Error('Expected accepted process start.');
  expect(result.process).toMatchObject({ invocationId: 'process-start-test', spawnedAt: 123_456 });
  expect(result.io).toMatchObject({ invocationId: 'process-start-test' });
  const token = getProcessStartInvocationToken(attempt);
  if (token === undefined) throw new Error('Expected process start invocation token.');
  expect(SpawnAcceptedProcess.isAuthentic(result.process)).toBe(true);
  expect(PausedProcessIo.isAuthentic(result.io)).toBe(true);
  expect(SpawnAcceptedProcess.isBoundToToken(result.process, token)).toBe(true);
  expect(PausedProcessIo.isBoundToToken(result.io, token)).toBe(true);
});

test('accepted spawn leaves quiescence pending for later cleanup or coordinator transfer', async () => {
  const port = new FakeProcessStartPort();
  port.enqueue('accepted');
  const { attempt } = createAttempt(port);

  beginStart(attempt, port);
  await expect(attempt.settlement).resolves.toMatchObject({ status: 'spawn_accepted' });

  await expectStillPending(attempt.quiescence);
});

test('failed spawn rejects and confirms not-spawned quiescence', async () => {
  const port = new FakeProcessStartPort();
  port.enqueue('failed');
  const { attempt } = createAttempt(port);

  beginStart(attempt, port);

  await expect(attempt.settlement).resolves.toEqual({ status: 'rejected', reason: 'spawn_failed' });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    disposition: 'not_spawned',
  });
  await expectNeverRejects(attempt.settlement, attempt.quiescence);
});

test.each([
  ['caller_cancel', 'cancelled_before_spawn'],
  ['manager_shutdown', 'manager_shutdown_before_spawn'],
] as const)(
  'cancellation before dispatch for %s rejects without calling the port',
  async (cancellationReason, rejectionReason) => {
    const port = new FakeProcessStartPort();
    port.enqueue('accepted');
    const { attempt } = createAttempt(port);

    attempt.requestCancellation(cancellationReason);
    beginStart(attempt, port);

    await expect(attempt.settlement).resolves.toEqual({
      status: 'rejected',
      reason: rejectionReason,
    });
    await expect(attempt.quiescence).resolves.toEqual({
      status: 'quiescent',
      disposition: 'not_spawned',
    });
    expect(port.attempts()).toEqual([]);
  },
);

test.each([
  ['caller_cancel', 'caller_cancel', 'cancelled_before_spawn'],
  ['caller_cancel', 'manager_shutdown', 'cancelled_before_spawn'],
  ['manager_shutdown', 'manager_shutdown', 'manager_shutdown_before_spawn'],
  ['manager_shutdown', 'caller_cancel', 'manager_shutdown_before_spawn'],
] as const)(
  'double cancellation keeps the first pre-dispatch reason for %s then %s',
  async (first, second, rejectionReason) => {
    const port = new FakeProcessStartPort();
    port.enqueue('accepted');
    const { attempt } = createAttempt(port);

    expect(() => {
      attempt.requestCancellation(first);
      attempt.requestCancellation(second);
    }).not.toThrow();
    beginStart(attempt, port);

    await expect(attempt.settlement).resolves.toEqual({
      status: 'rejected',
      reason: rejectionReason,
    });
    await expect(attempt.quiescence).resolves.toEqual({
      status: 'quiescent',
      disposition: 'not_spawned',
    });
    expect(port.attempts()).toEqual([]);
  },
);

test('synchronous dispatch throw maps to spawn_failed and not-spawned quiescence', async () => {
  const port = new FakeProcessStartPort();
  port.enqueue('throw-on-dispatch');
  const { attempt } = createAttempt(port);

  expect(() => beginStart(attempt, port)).not.toThrow();

  await expect(attempt.settlement).resolves.toEqual({ status: 'rejected', reason: 'spawn_failed' });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    disposition: 'not_spawned',
  });
});

test('late cancellation after dispatch does not override a later accepted spawn', async () => {
  const port = new FakeProcessStartPort();
  port.enqueue('pending');
  const { attempt } = createAttempt(port);

  beginStart(attempt, port);
  attempt.requestCancellation('caller_cancel');
  port.settlePendingAccepted(1, 654_321);

  const result = await attempt.settlement;
  expect(result.status).toBe('spawn_accepted');
  if (result.status !== 'spawn_accepted') throw new Error('Expected accepted process start.');
  expect(result.process.spawnedAt).toBe(654_321);
  expect(port.attempts()).toHaveLength(1);
  expect(port.pendingStartCount()).toBe(0);
});
