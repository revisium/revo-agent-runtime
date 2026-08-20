import { expect, test } from 'vitest';

import {
  registerSecrets,
  revealRegisteredSecrets,
} from '../../../../src/runtime/execution/index.js';

test('registers an authentic capability without structurally exposing secret values', () => {
  const configuredSecret = 'configured-secret-value';
  const invocationSecret = 'invocation-secret-value';

  const registered = registerSecrets({
    configuredSecrets: [configuredSecret],
    invocationSecrets: [invocationSecret],
  });

  expect(registered.status).toBe('registered');
  expect(Object.isFrozen(registered)).toBe(true);
  if (registered.status !== 'registered') throw new Error('Expected registered secrets.');
  expect(Object.keys(registered)).toEqual(['status', 'registeredSecrets']);
  expect(Object.hasOwn(registered, 'secretValues')).toBe(false);
  expect(Object.keys(registered.registeredSecrets)).toEqual([]);
  expect(Object.hasOwn(registered.registeredSecrets, 'secretValues')).toBe(false);
  expect(JSON.stringify(registered)).not.toContain(configuredSecret);
  expect(JSON.stringify(registered)).not.toContain(invocationSecret);
  expect(Object.hasOwn(registered, 'add')).toBe(false);
  expect(Object.hasOwn(registered, 'register')).toBe(false);
});

test('reveals deduplicated configured-first secrets only from authentic capabilities', () => {
  const registered = registerSecrets({
    configuredSecrets: ['A', 'B'],
    invocationSecrets: ['B', 'C'],
  });

  if (registered.status !== 'registered') throw new Error('Expected registered secrets.');
  const secretValues = revealRegisteredSecrets(registered.registeredSecrets);

  expect(secretValues).toEqual(['A', 'B', 'C']);
  expect(Object.isFrozen(secretValues)).toBe(true);
  expect(() => Reflect.apply(Array.prototype.push, secretValues, ['late'])).toThrow();
});

test('does not reveal forged or non-authentic registered secret look-alikes', () => {
  expect(revealRegisteredSecrets({ secretValues: ['fake'] })).toBeUndefined();
  expect(revealRegisteredSecrets(undefined)).toBeUndefined();
  expect(revealRegisteredSecrets(null)).toBeUndefined();
  expect(revealRegisteredSecrets('secret')).toBeUndefined();
  expect(revealRegisteredSecrets(Object.freeze({ status: 'registered' }))).toBeUndefined();
});

test('rejects invalid secret inputs without leaking rejected values', () => {
  expect(registerSecrets({ configuredSecrets: [''], invocationSecrets: [] })).toEqual({
    status: 'rejected',
    reason: 'empty_secret_value',
  });

  expect(
    Reflect.apply(registerSecrets, undefined, [
      { configuredSecrets: 'not-an-array', invocationSecrets: [] },
    ]),
  ).toEqual({ status: 'rejected', reason: 'invalid_request' });

  const rejectedValue = 'must-not-appear';
  const rejected: unknown = Reflect.apply(registerSecrets, undefined, [
    { configuredSecrets: [rejectedValue, 42], invocationSecrets: [] },
  ]);
  expect(rejected).toEqual({ status: 'rejected', reason: 'invalid_request' });
  expect(JSON.stringify(rejected)).not.toContain(rejectedValue);
});
