import { expect, test } from 'vitest';

import * as runtimeExecution from '../../../../src/runtime/execution/index.js';
import {
  beginOutputClaim,
  createOutputClaimAttempt,
  registerSecrets,
  type ConsumedRedactionMaterial,
  type OutputPreparationAttempt,
  type RegisteredSecrets,
} from '../../../../src/runtime/execution/index.js';
import {
  createOutputPreparationAttempt,
  getOutputPreparationInvocationToken,
  isConsumedRedactionMaterialBoundToToken,
  type TerminalPublicationAuthority,
} from '../../../../src/runtime/execution/output-preparation-attempt/index.js';
import {
  consumeRedactionMaterial,
  createPreparedExecutionSecurity,
  takePreparedChildEnvironment,
} from '../../../../src/runtime/execution/prepared-execution-security/index.js';
import { FakeInvocationClock } from '../../../support/execution/fake-clock.js';
import { FakeOutputClaimPort } from '../../../support/execution/fake-output-claim-port.js';
import { FakeOutputPreparationPort } from '../../../support/execution/fake-output-preparation-port.js';

const register = (values: readonly string[] = ['secret-value']): RegisteredSecrets => {
  const registered = registerSecrets({ configuredSecrets: values, invocationSecrets: [] });
  if (registered.status !== 'registered') throw new Error('Expected registered secrets.');
  return registered.registeredSecrets;
};

const claimedSession = async (invocationId = 'security-test') => {
  const clock = new FakeInvocationClock({ initialNowMs: 1_000 });
  const port = new FakeOutputClaimPort();
  port.enqueue('created');
  const claim = createOutputClaimAttempt({
    invocationId,
    outputDirectory: `/outputs/${invocationId}`,
    clock,
    port,
  });
  beginOutputClaim(claim);
  const result = await claim.settlement;
  if (result.status !== 'claimed') throw new Error('Expected claimed output session.');
  return result.session;
};

const preparationAttempt = async (
  invocationId = 'security-test',
): Promise<OutputPreparationAttempt> => {
  const attempt = createOutputPreparationAttempt({
    session: await claimedSession(invocationId),
    clock: new FakeInvocationClock({ initialNowMs: 1_000 }),
    port: new FakeOutputPreparationPort(),
  });
  if (attempt === undefined) throw new Error('Expected output preparation attempt.');
  return attempt;
};

const security = (invocationId = 'security-test') => {
  const capability = createPreparedExecutionSecurity({
    invocationId,
    childEnvironment: { SAFE_ENV: 'initial-value' },
    registeredSecrets: register(),
  });
  if (capability === undefined) throw new Error('Expected prepared execution security.');
  return capability;
};

const redactionFields = (material: ConsumedRedactionMaterial): readonly string[] =>
  Reflect.ownKeys(material).map(String);

const authority = async (): Promise<TerminalPublicationAuthority> =>
  (await preparationAttempt()).authority;

test('creates an authentic security capability without exposing environment or secrets', () => {
  const secret = 'secret-value';
  const environmentValue = 'environment-value';

  const capability = createPreparedExecutionSecurity({
    invocationId: 'security-test',
    childEnvironment: { SAFE_ENV: environmentValue },
    registeredSecrets: register([secret]),
  });

  expect(capability).toBeDefined();
  if (capability === undefined) throw new Error('Expected prepared execution security.');
  expect(Reflect.ownKeys(capability).map(String)).toEqual(['invocationId']);
  expect(Object.isFrozen(capability)).toBe(true);
  expect(JSON.stringify(capability)).not.toContain(secret);
  expect(JSON.stringify(capability)).not.toContain(environmentValue);
});

test('rejects forged registered-secret capabilities', () => {
  expect(
    Reflect.apply(createPreparedExecutionSecurity, undefined, [
      {
        invocationId: 'security-test',
        childEnvironment: { SAFE_ENV: 'value' },
        registeredSecrets: { secretValues: ['fake'] },
      },
    ]),
  ).toBeUndefined();
});

test('rejects accessor-backed and non-string environment records', () => {
  const accessorEnvironment = {};
  Object.defineProperty(accessorEnvironment, 'SAFE_ENV', {
    get: () => 'value',
    enumerable: true,
  });

  expect(
    createPreparedExecutionSecurity({
      invocationId: 'security-test',
      childEnvironment: accessorEnvironment,
      registeredSecrets: register(),
    }),
  ).toBeUndefined();
  expect(
    Reflect.apply(createPreparedExecutionSecurity, undefined, [
      {
        invocationId: 'security-test',
        childEnvironment: { SAFE_ENV: 42 },
        registeredSecrets: register(),
      },
    ]),
  ).toBeUndefined();
});

test('defensively copies the caller-owned environment', () => {
  const environment = { SAFE_ENV: 'original' };
  const capability = createPreparedExecutionSecurity({
    invocationId: 'security-test',
    childEnvironment: environment,
    registeredSecrets: register(),
  });
  if (capability === undefined) throw new Error('Expected prepared execution security.');

  environment.SAFE_ENV = 'mutated';

  expect(takePreparedChildEnvironment(capability)).toEqual({ SAFE_ENV: 'original' });
});

test('consumes redaction material into an authentic frozen invocation-only carrier', async () => {
  const attempt = await preparationAttempt();
  const material = consumeRedactionMaterial(security(), attempt);

  expect(material).toBeDefined();
  if (material === undefined) throw new Error('Expected consumed redaction material.');
  expect(redactionFields(material)).toEqual(['invocationId']);
  expect(Object.isFrozen(material)).toBe(true);
  expect(JSON.stringify(material)).not.toContain('secret-value');
});

test('consumed redaction material is bound to the same token as its source attempt', async () => {
  const attempt = await preparationAttempt();
  const material = consumeRedactionMaterial(security(), attempt);
  if (material === undefined) throw new Error('Expected consumed redaction material.');
  const attemptToken = getOutputPreparationInvocationToken(attempt);
  if (attemptToken === undefined) throw new Error('Expected an authentic attempt token.');

  expect(isConsumedRedactionMaterialBoundToToken(material, attemptToken)).toBe(true);

  const otherAttempt = await preparationAttempt('other-test');
  const otherToken = getOutputPreparationInvocationToken(otherAttempt);
  if (otherToken === undefined) throw new Error('Expected an authentic attempt token.');
  expect(isConsumedRedactionMaterialBoundToToken(material, otherToken)).toBe(false);
});

test('rejects forged security capabilities without throwing', async () => {
  await expect(
    Promise.resolve(
      consumeRedactionMaterial({ invocationId: 'security-test' }, await preparationAttempt()),
    ),
  ).resolves.toBeUndefined();
});

test('rejects a forged attempt-shaped object without consuming redaction', async () => {
  const realAuthority = await authority();
  const forged: OutputPreparationAttempt = {
    invocationId: 'security-test',
    outputDirectory: '/outputs/security-test',
    authority: realAuthority,
    settlement: Promise.resolve(
      Object.freeze({
        status: 'uncertain',
        reason: 'preparation_state_unknown',
        authority: realAuthority,
      }),
    ),
    quiescence: Promise.resolve(Object.freeze({ status: 'retained', authority: realAuthority })),
    requestCancellation: () => undefined,
  };

  expect(consumeRedactionMaterial(security(), forged)).toBeUndefined();
});

test('mismatched invocation ids reject without consuming the retryable redaction bundle', async () => {
  const capability = security('security-test');

  expect(
    consumeRedactionMaterial(capability, await preparationAttempt('other-test')),
  ).toBeUndefined();
  expect(
    consumeRedactionMaterial(capability, await preparationAttempt('security-test')),
  ).toBeDefined();
});

test('redaction material is one-use after the first successful consume', async () => {
  const capability = security();

  expect(consumeRedactionMaterial(capability, await preparationAttempt())).toBeDefined();
  // This slice cannot observe why repeats fail; it only proves every later consume returns undefined.
  expect(consumeRedactionMaterial(capability, await preparationAttempt())).toBeUndefined();
  expect(consumeRedactionMaterial(capability, await preparationAttempt())).toBeUndefined();
});

test('environment and redaction bundles consume independently', async () => {
  const environmentFirst = security();
  expect(takePreparedChildEnvironment(environmentFirst)).toEqual({ SAFE_ENV: 'initial-value' });
  expect(consumeRedactionMaterial(environmentFirst, await preparationAttempt())).toBeDefined();

  const redactionFirst = security();
  expect(consumeRedactionMaterial(redactionFirst, await preparationAttempt())).toBeDefined();
  expect(takePreparedChildEnvironment(redactionFirst)).toEqual({ SAFE_ENV: 'initial-value' });
});

test('taking child environment from a forged capability returns undefined without throwing', () => {
  expect(takePreparedChildEnvironment({ invocationId: 'security-test' })).toBeUndefined();
  expect(takePreparedChildEnvironment(undefined)).toBeUndefined();
});

test('runtime execution layer barrel does not expose prepared-execution-security values', () => {
  expect('createPreparedExecutionSecurity' in runtimeExecution).toBe(false);
  expect('consumeRedactionMaterial' in runtimeExecution).toBe(false);
  expect('takePreparedChildEnvironment' in runtimeExecution).toBe(false);
  expect('PreparedExecutionSecurity' in runtimeExecution).toBe(false);
});
