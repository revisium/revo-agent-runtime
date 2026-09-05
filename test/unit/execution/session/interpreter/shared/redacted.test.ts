import { expect, test } from 'vitest';

import { redactSessionValue } from '../../../../../../src/execution/session/interpreter/shared/value/redacted.js';

test('redacts presentation and nested metadata while preserving response identities', () => {
  const input = {
    title: 'Use SECRET',
    options: [{ optionId: 'allow', label: 'Allow SECRET' }],
    metadata: { nested: ['SECRET', { value: 'SECRET' }] },
  };
  const value = redactSessionValue(input, ['SECRET']);
  expect(JSON.stringify(value)).not.toContain('SECRET');
  expect(value.options[0]?.optionId).toBe('allow');
  expect(input.title).toBe('Use SECRET');
  expect(Object.isFrozen(value.options[0])).toBe(true);
});

test('fails closed instead of changing secret-bearing protocol identities', () => {
  expect(() => redactSessionValue({ optionId: 'SECRET' }, ['SECRET'])).toThrow('contains a secret');
  expect(redactSessionValue({ optionId: 'allow' }, [''])).toEqual({ optionId: 'allow' });
});

test('fails closed for secret-bearing metadata keys', () => {
  expect(() => redactSessionValue({ metadata: { SECRET: 'value' } }, ['SECRET'])).toThrow(
    'contains a secret',
  );
});
