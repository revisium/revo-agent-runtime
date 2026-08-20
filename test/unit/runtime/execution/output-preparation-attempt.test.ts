import { expect, test } from 'vitest';

import * as runtimeExecution from '../../../../src/runtime/execution/index.js';
import {
  beginOutputClaim,
  createOutputClaimAttempt,
} from '../../../../src/runtime/execution/index.js';
import type {
  ConsumedOutputPreparationMaterial,
  ConsumedRedactionMaterial,
  OutputPreparationQuiescence,
  OutputPreparationResult,
} from '../../../../src/runtime/execution/index.js';
import { registerSecrets } from '../../../../src/runtime/execution/index.js';
import {
  beginOutputPreparation,
  createOutputPreparationAttempt,
  type OutputPreparationAttempt,
  type PreparedInvocationResources,
  type TerminalPublicationAuthority,
} from '../../../../src/runtime/execution/output-preparation-attempt/index.js';
import {
  consumeRedactionMaterial,
  createPreparedExecutionSecurity,
} from '../../../../src/runtime/execution/prepared-execution-security/index.js';
import { FakeInvocationClock } from '../../../support/execution/fake-clock.js';
import { FakeOutputClaimPort } from '../../../support/execution/fake-output-claim-port.js';
import {
  FakeOutputPreparationPort,
  type FakeOutputPreparationOperation,
} from '../../../support/execution/fake-output-preparation-port.js';

const sessionInput = () => ({
  invocationId: 'preparation-test',
  outputDirectory: '/outputs/preparation-test',
});

const material = (): ConsumedOutputPreparationMaterial => ({ ...sessionInput() });

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
  result: Promise<OutputPreparationResult>,
  quiescence: Promise<OutputPreparationQuiescence>,
): Promise<void> => {
  await expect(result).resolves.toBeDefined();
  await expect(quiescence).resolves.toBeDefined();
};

const claimedSession = async () => {
  const clock = new FakeInvocationClock({ initialNowMs: 1_000 });
  const claimPort = new FakeOutputClaimPort();
  claimPort.enqueue('created');
  const claim = createOutputClaimAttempt({ ...sessionInput(), clock, port: claimPort });
  beginOutputClaim(claim);
  const result = await claim.settlement;
  if (result.status !== 'claimed') throw new Error('Expected claimed output session.');
  return result.session;
};

const createAttempt = async (port: FakeOutputPreparationPort) => {
  const clock = new FakeInvocationClock({ initialNowMs: 1_000 });
  const attempt = createOutputPreparationAttempt({ session: await claimedSession(), clock, port });
  if (attempt === undefined) throw new Error('Expected authentic output preparation attempt.');
  return { attempt, clock };
};

const redaction = (attempt: OutputPreparationAttempt): ConsumedRedactionMaterial => {
  const registered = registerSecrets({
    configuredSecrets: ['secret-value'],
    invocationSecrets: [],
  });
  if (registered.status !== 'registered') throw new Error('Expected registered secrets.');
  const security = createPreparedExecutionSecurity({
    invocationId: attempt.invocationId,
    childEnvironment: { SAFE_ENV: 'value' },
    registeredSecrets: registered.registeredSecrets,
  });
  if (security === undefined) throw new Error('Expected prepared execution security.');
  const consumed = consumeRedactionMaterial(security, attempt);
  if (consumed === undefined) throw new Error('Expected consumed redaction material.');
  return consumed;
};

const beginPreparation = (
  attempt: OutputPreparationAttempt,
  inputMaterial: ConsumedOutputPreparationMaterial = material(),
  inputRedaction: ConsumedRedactionMaterial = redaction(attempt),
): void => {
  beginOutputPreparation(attempt, inputMaterial, inputRedaction);
};

const authorityFields = (authority: TerminalPublicationAuthority): readonly string[] =>
  Reflect.ownKeys(authority).map(String);

const resourceFields = (resources: PreparedInvocationResources): readonly string[] =>
  Reflect.ownKeys(resources).map(String);

test('successful preparation before the deadline fulfills quiescence no later than prepared settlement', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('prepared');
  const { attempt, clock } = await createAttempt(port);
  const observed: string[] = [];
  void attempt.settlement.then(() => observed.push('settlement'));
  void attempt.quiescence.then(() => observed.push('quiescence'));

  beginPreparation(attempt);

  await expect(attempt.settlement).resolves.toMatchObject({ status: 'prepared' });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    mutationDispatched: true,
  });
  expect(observed).toEqual(['quiescence', 'settlement']);
  expect(clock.pendingActionCount()).toBe(0);
  await expectNeverRejects(attempt.settlement, attempt.quiescence);
});

test('prepared result returns the attempt authority by identity and resources for the claimed session', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('prepared');
  const { attempt } = await createAttempt(port);

  beginPreparation(attempt);
  const result = await attempt.settlement;

  expect(result.status).toBe('prepared');
  if (result.status !== 'prepared') throw new Error('Expected prepared result.');
  expect(result.authority).toBe(attempt.authority);
  expect(result.resources).toMatchObject(sessionInput());
});

test.each([
  ['scratch-conflict', 'scratch_conflict', true],
  ['scratch-create-failed', 'scratch_create_failed', true],
  ['scratch-write-failed', 'scratch_write_failed', true],
  ['scratch-flush-failed', 'scratch_flush_failed', true],
  ['redaction-sink-create-failed', 'redaction_sink_create_failed', true],
  ['evidence-open-failed', 'evidence_open_failed', true],
] as const)(
  '%s maps to the identical rejected reason with observed dispatch state',
  async (operation, reason, mutationDispatched) => {
    const port = new FakeOutputPreparationPort();
    port.enqueue(operation);
    const { attempt } = await createAttempt(port);

    beginPreparation(attempt);

    await expect(attempt.settlement).resolves.toEqual({
      status: 'rejected',
      reason,
      authority: attempt.authority,
    });
    await expect(attempt.quiescence).resolves.toEqual({ status: 'quiescent', mutationDispatched });
  },
);

test('platform rejection reported without a prior mark call reports undispatched quiescence', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('rejected-without-dispatch');
  const { attempt } = await createAttempt(port);

  beginPreparation(attempt);

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'scratch_create_failed',
    authority: attempt.authority,
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    mutationDispatched: false,
  });
});

test('raw promise rejection after dispatch becomes uncertain and retained without rejecting promises', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('reject');
  const { attempt } = await createAttempt(port);

  beginPreparation(attempt);

  await expect(attempt.settlement).resolves.toEqual({
    status: 'uncertain',
    reason: 'preparation_state_unknown',
    authority: attempt.authority,
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'retained',
    authority: attempt.authority,
  });
  await expectNeverRejects(attempt.settlement, attempt.quiescence);
});

test('raw promise rejection before dispatch becomes internal-before-mutation rejection', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('reject-without-dispatch');
  const { attempt } = await createAttempt(port);

  beginPreparation(attempt);

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'internal_before_mutation',
    authority: attempt.authority,
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    mutationDispatched: false,
  });
});

test('cancellation observed before any port call rejects and never contacts the port', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('prepared');
  const { attempt, clock } = await createAttempt(port);

  attempt.requestCancellation();
  beginPreparation(attempt);

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'cancelled_before_mutation',
    authority: attempt.authority,
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    mutationDispatched: false,
  });
  expect(port.requests()).toEqual([]);
  expect(clock.pendingActionCount()).toBe(0);
});

test('beginOutputPreparation is one-use while the first mutation is still pending', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('pending');
  const { attempt } = await createAttempt(port);
  const firstMaterial = material();
  const firstRedaction = redaction(attempt);
  const secondMaterial = { invocationId: 'second', outputDirectory: '/outputs/second' };
  const secondAttempt = await createAttempt(new FakeOutputPreparationPort());
  const secondRedaction = redaction(secondAttempt.attempt);

  beginPreparation(attempt, firstMaterial, firstRedaction);
  beginPreparation(attempt, secondMaterial, secondRedaction);

  expect(port.requests()).toHaveLength(1);
  expect(port.requests()[0]?.material).toBe(firstMaterial);
  expect(port.requests()[0]?.redaction).toBe(firstRedaction);
  expect(port.requests()[0]?.material).not.toBe(secondMaterial);
  expect(port.requests()[0]?.redaction).not.toBe(secondRedaction);
  port.settlePendingPrepared(1);
  await expect(attempt.settlement).resolves.toMatchObject({ status: 'prepared' });
});

test('cancellation after dispatch does not reinterpret a later successful preparation', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('pending');
  const { attempt } = await createAttempt(port);

  beginPreparation(attempt);
  attempt.requestCancellation();
  port.settlePendingPrepared(1);

  await expect(attempt.settlement).resolves.toMatchObject({
    status: 'prepared',
    authority: attempt.authority,
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    mutationDispatched: true,
  });
});

test('synchronous throw before dispatch is caught and settles internal-before-mutation without throwing', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('throw-before-dispatch');
  const { attempt, clock } = await createAttempt(port);

  expect(() => beginPreparation(attempt)).not.toThrow();

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'internal_before_mutation',
    authority: attempt.authority,
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    mutationDispatched: false,
  });
  expect(clock.pendingActionCount()).toBe(0);
});

test('a port returning a non-promise value synchronously is treated as a failure before dispatch', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('non-promise-return');
  const { attempt } = await createAttempt(port);

  expect(() => beginPreparation(attempt)).not.toThrow();

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'internal_before_mutation',
    authority: attempt.authority,
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    mutationDispatched: false,
  });
});

test('synchronous throw after dispatch retains the identical authority for unknown preparation state', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('throw-after-dispatch');
  const { attempt } = await createAttempt(port);

  expect(() => beginPreparation(attempt)).not.toThrow();

  await expect(attempt.settlement).resolves.toEqual({
    status: 'uncertain',
    reason: 'preparation_state_unknown',
    authority: attempt.authority,
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'retained',
    authority: attempt.authority,
  });
});

test.each(['pending', 'pending-without-dispatch'] as const)(
  'deadline retains the identical authority for %s regardless of dispatch marker',
  async (operation: FakeOutputPreparationOperation) => {
    const port = new FakeOutputPreparationPort();
    port.enqueue(operation);
    const { attempt, clock } = await createAttempt(port);

    beginPreparation(attempt);
    clock.advanceBy(10_000);

    await expect(attempt.settlement).resolves.toEqual({
      status: 'uncertain',
      reason: 'preparation_timeout',
      authority: attempt.authority,
    });
    await expect(attempt.quiescence).resolves.toEqual({
      status: 'retained',
      authority: attempt.authority,
    });
  },
);

test('late platform outcomes after timeout do not become observable and promises never reject', async () => {
  const preparedPort = new FakeOutputPreparationPort();
  preparedPort.enqueue('pending');
  const prepared = await createAttempt(preparedPort);
  beginPreparation(prepared.attempt);
  prepared.clock.advanceBy(10_000);
  const preparedResult = await prepared.attempt.settlement;
  const preparedQuiescence = await prepared.attempt.quiescence;
  preparedPort.settlePendingPrepared(1);

  const rejectedPort = new FakeOutputPreparationPort();
  rejectedPort.enqueue('pending');
  const rejected = await createAttempt(rejectedPort);
  beginPreparation(rejected.attempt);
  rejected.clock.advanceBy(10_000);
  const rejectedResult = await rejected.attempt.settlement;
  const rejectedQuiescence = await rejected.attempt.quiescence;
  rejectedPort.settlePendingRejected(1, 'scratch_create_failed');
  await flushPromises();
  await expect(prepared.attempt.settlement).resolves.toBe(preparedResult);
  await expect(prepared.attempt.quiescence).resolves.toBe(preparedQuiescence);
  await expect(rejected.attempt.settlement).resolves.toBe(rejectedResult);
  await expect(rejected.attempt.quiescence).resolves.toBe(rejectedQuiescence);
  await expectNeverRejects(prepared.attempt.settlement, prepared.attempt.quiescence);
  await expectNeverRejects(rejected.attempt.settlement, rejected.attempt.quiescence);
});

test('inauthentic session makes the factory return undefined without clock or port contact', () => {
  const port = new FakeOutputPreparationPort();
  const clock = new FakeInvocationClock({ initialNowMs: 1_000 });

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const attempt = createOutputPreparationAttempt({ session: sessionInput() as never, clock, port });

  expect(attempt).toBeUndefined();
  expect(port.requests()).toEqual([]);
  expect(clock.pendingActionCount()).toBe(0);
});

test('runtime execution layer barrel does not expose preparation authority or invoker values', () => {
  expect('TerminalPublicationAuthority' in runtimeExecution).toBe(false);
  expect('PreparedInvocationResources' in runtimeExecution).toBe(false);
  expect('createOutputPreparationAttempt' in runtimeExecution).toBe(false);
  expect('beginOutputPreparation' in runtimeExecution).toBe(false);
});

test('factory returns a synchronously registered unsettled attempt with authority and armed deadline', async () => {
  const port = new FakeOutputPreparationPort();
  const clock = new FakeInvocationClock({ initialNowMs: 1_000 });

  const attempt = createOutputPreparationAttempt({ session: await claimedSession(), clock, port });

  expect(attempt).toBeDefined();
  if (attempt === undefined) throw new Error('Expected authentic preparation attempt.');
  expect(attempt.authority).toMatchObject(sessionInput());
  expect(attempt.settlement).toBeInstanceOf(Promise);
  expect(attempt.quiescence).toBeInstanceOf(Promise);
  expect(clock.pendingActionCount()).toBe(1);
  expect(await settled(attempt.settlement)).toBeUndefined();
  expect(await settled(attempt.quiescence)).toBeUndefined();
});

test('authority and prepared resources expose only informational invocation fields', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('prepared');
  const { attempt } = await createAttempt(port);

  expect(authorityFields(attempt.authority)).toEqual(['invocationId', 'outputDirectory']);
  beginPreparation(attempt);
  const result = await attempt.settlement;
  if (result.status !== 'prepared') throw new Error('Expected prepared resources.');
  expect(resourceFields(result.resources)).toEqual(['invocationId', 'outputDirectory']);
});

test('beginOutputPreparation on a forged attempt-shaped object is a silent no-op', async () => {
  const port = new FakeOutputPreparationPort();
  const { attempt } = await createAttempt(port);
  const forged: OutputPreparationAttempt = {
    ...sessionInput(),
    authority: attempt.authority,
    settlement: Promise.resolve(
      Object.freeze({
        status: 'uncertain',
        reason: 'preparation_state_unknown',
        authority: attempt.authority,
      }),
    ),
    quiescence: Promise.resolve(
      Object.freeze({ status: 'retained', authority: attempt.authority }),
    ),
    requestCancellation: () => undefined,
  };

  expect(() => beginOutputPreparation(forged, material(), redaction(attempt))).not.toThrow();
  expect(port.requests()).toEqual([]);
});

test('material and redaction bundles are passed by reference and never read by the shell', async () => {
  const port = new FakeOutputPreparationPort();
  port.enqueue('prepared');
  const { attempt } = await createAttempt(port);
  let reads = 0;
  const countedMaterial = new Proxy(material(), {
    get(target, property) {
      reads += 1;
      if (property === 'invocationId') return target.invocationId;
      if (property === 'outputDirectory') return target.outputDirectory;
      return undefined;
    },
  });
  const consumedMaterial = redaction(attempt);

  beginPreparation(attempt, countedMaterial, consumedMaterial);
  await expect(attempt.settlement).resolves.toMatchObject({ status: 'prepared' });

  expect(port.requests()[0]?.material).toBe(countedMaterial);
  expect(port.requests()[0]?.redaction).toBe(consumedMaterial);
  expect(reads).toBe(0);
});

test.each([
  ['rejected', 'scratch-create-failed'],
  ['uncertain', 'reject'],
] as const)('%s path fulfills quiescence no later than settlement', async (_name, operation) => {
  const port = new FakeOutputPreparationPort();
  port.enqueue(operation);
  const { attempt } = await createAttempt(port);
  const observed: string[] = [];
  void attempt.settlement.then(() => observed.push('settlement'));
  void attempt.quiescence.then(() => observed.push('quiescence'));

  beginPreparation(attempt);
  await attempt.settlement;
  await attempt.quiescence;

  expect(observed).toEqual(['quiescence', 'settlement']);
});
