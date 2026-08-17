import { expect, test } from 'vitest';

import { registerSecrets } from '../../../../src/runtime/execution/index.js';

test('registers an immutable configured-first list and rejects invalid secret inputs', () => {
  const registered = registerSecrets({
    configuredSecrets: ['A', 'B'],
    invocationSecrets: ['B', 'C'],
  });

  expect(registered).toEqual({ status: 'registered', secretValues: ['A', 'B', 'C'] });
  expect(Object.isFrozen(registered)).toBe(true);
  if (registered.status !== 'registered') throw new Error('Expected registered secrets.');
  expect(Object.isFrozen(registered.secretValues)).toBe(true);
  expect(() => Reflect.apply(Array.prototype.push, registered.secretValues, ['late'])).toThrow();
  expect(Object.hasOwn(registered, 'add')).toBe(false);
  expect(Object.hasOwn(registered, 'register')).toBe(false);

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
