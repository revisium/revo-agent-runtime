import { expect, test } from 'vitest';

import { captureChildEnvironment } from '../../../../src/runtime/execution/index.js';

test('captures only the named host variables and nothing else from the host snapshot', () => {
  const hostSnapshot = { HOME: '/home/agent', PATH: '/usr/bin', AWS_SECRET_KEY: 'leaked' };
  const result = captureChildEnvironment(
    { inherit: ['HOME'], variables: {}, secrets: {} },
    hostSnapshot,
  );

  expect(result.status).toBe('captured');
  if (result.status !== 'captured') return;
  expect(result.environment).toEqual({ HOME: '/home/agent' });
  expect(Object.keys(result.environment)).toHaveLength(1);
});

test('rejects a key that does not match the environment key shape', () => {
  const result = captureChildEnvironment(
    { inherit: [], variables: { 'bad-key': 'value' }, secrets: {} },
    {},
  );

  expect(result).toEqual({ status: 'rejected', reason: 'invalid_key' });
});

test('rejects credential-like names in inherit and variables but accepts them in secrets', () => {
  const credentialLikeNames = [
    'API_KEY',
    'AUTH_TOKEN',
    'MY_PASSWORD',
    'db_credential',
    'PRIVATE_KEY',
  ];

  for (const name of credentialLikeNames) {
    expect(
      captureChildEnvironment({ inherit: [], variables: { [name]: 'value' }, secrets: {} }, {}),
    ).toEqual({ status: 'rejected', reason: 'credential_like_name' });
  }

  for (const name of ['API_KEY', 'AUTH_TOKEN', 'MY_PASSWORD', 'db_credential', 'PRIVATE_KEY']) {
    const result = captureChildEnvironment(
      { inherit: [], variables: {}, secrets: { [name]: 'value' } },
      {},
    );
    expect(result.status).toBe('captured');
  }
});

test('rejects a name repeated within one collection or across two collections', () => {
  expect(
    captureChildEnvironment({ inherit: [], variables: { SAME: 'a' }, secrets: { SAME: 'b' } }, {}),
  ).toEqual({ status: 'rejected', reason: 'duplicate_name' });

  expect(
    captureChildEnvironment({ inherit: ['HOME', 'HOME'], variables: {}, secrets: {} }, {}),
  ).toEqual({ status: 'rejected', reason: 'duplicate_name' });
});

test('rejects an inherit name absent from the host snapshot', () => {
  expect(captureChildEnvironment({ inherit: ['MISSING'], variables: {}, secrets: {} }, {})).toEqual(
    { status: 'rejected', reason: 'missing_inherit_variable' },
  );
});

test('rejects an empty secret value', () => {
  expect(
    captureChildEnvironment({ inherit: [], variables: {}, secrets: { SECRET: '' } }, {}),
  ).toEqual({ status: 'rejected', reason: 'empty_secret_value' });
});

test('enforces the 128-key, 128-byte-key, 64 KiB-value, and 256 KiB-total bounds at each boundary', () => {
  const secretsAtLimit: Record<string, string> = {};
  for (let index = 0; index < 128; index += 1) secretsAtLimit[`KEY_${index}`] = 'v';
  expect(
    captureChildEnvironment({ inherit: [], variables: {}, secrets: secretsAtLimit }, {}).status,
  ).toBe('captured');

  const secretsOverLimit: Record<string, string> = { ...secretsAtLimit, EXTRA_KEY: 'v' };
  expect(
    captureChildEnvironment({ inherit: [], variables: {}, secrets: secretsOverLimit }, {}),
  ).toEqual({ status: 'rejected', reason: 'too_many_keys' });

  const keyAtLimit = `K${'x'.repeat(127)}`;
  const keyOverLimit = `K${'x'.repeat(128)}`;
  expect(
    captureChildEnvironment({ inherit: [], variables: {}, secrets: { [keyAtLimit]: 'v' } }, {})
      .status,
  ).toBe('captured');
  expect(
    captureChildEnvironment({ inherit: [], variables: {}, secrets: { [keyOverLimit]: 'v' } }, {}),
  ).toEqual({ status: 'rejected', reason: 'key_too_large' });

  const valueAtLimit = 'v'.repeat(65_536);
  const valueOverLimit = 'v'.repeat(65_537);
  expect(
    captureChildEnvironment({ inherit: [], variables: {}, secrets: { SECRET: valueAtLimit } }, {})
      .status,
  ).toBe('captured');
  expect(
    captureChildEnvironment(
      { inherit: [], variables: {}, secrets: { SECRET: valueOverLimit } },
      {},
    ),
  ).toEqual({ status: 'rejected', reason: 'value_too_large' });

  const buildTotalBoundSecrets = (extraByteOnLastValue: number): Record<string, string> => {
    const secrets: Record<string, string> = {};
    for (let index = 0; index < 128; index += 1) {
      const key = `K${String(index).padStart(3, '0')}`;
      const extra = index === 127 ? extraByteOnLastValue : 0;
      secrets[key] = 'v'.repeat(2_044 + extra);
    }
    return secrets;
  };

  expect(
    captureChildEnvironment({ inherit: [], variables: {}, secrets: buildTotalBoundSecrets(0) }, {})
      .status,
  ).toBe('captured');
  expect(
    captureChildEnvironment({ inherit: [], variables: {}, secrets: buildTotalBoundSecrets(1) }, {}),
  ).toEqual({ status: 'rejected', reason: 'total_size_exceeded' });
});

test('produces the ordered, de-duplicated list of secret values without leaking a value in a rejection', () => {
  const result = captureChildEnvironment(
    { inherit: [], variables: {}, secrets: { FIRST: 'shared', SECOND: 'shared', THIRD: 'unique' } },
    {},
  );

  expect(result.status).toBe('captured');
  if (result.status !== 'captured') return;
  expect(result.secretValues).toEqual(['shared', 'unique']);

  const rejection = captureChildEnvironment(
    { inherit: [], variables: {}, secrets: { SECRET: '' } },
    {},
  );
  expect(JSON.stringify(rejection)).not.toContain('shared');
});

test('produces the union of resolved inherit, variables, and secrets and no other host key', () => {
  const result = captureChildEnvironment(
    {
      inherit: ['HOME'],
      variables: { REGION: 'value' },
      secrets: { CREDENTIAL: 'token-value' },
    },
    { HOME: '/home/agent', PATH: '/usr/bin' },
  );

  expect(result.status).toBe('captured');
  if (result.status !== 'captured') return;
  expect(result.environment).toEqual({
    HOME: '/home/agent',
    REGION: 'value',
    CREDENTIAL: 'token-value',
  });
});

test('freezes the result and isolates it from mutation of the caller-owned request and host snapshot', () => {
  const inherit = ['HOME'];
  const variables: Record<string, string> = { VAR: 'value' };
  const secrets: Record<string, string> = { SECRET: 'value' };
  const hostSnapshot: Record<string, string> = { HOME: '/home/agent' };

  const result = captureChildEnvironment({ inherit, variables, secrets }, hostSnapshot);
  expect(result.status).toBe('captured');
  if (result.status !== 'captured') return;

  inherit.push('INJECTED');
  variables.VAR = 'mutated';
  secrets.SECRET = 'mutated';
  hostSnapshot.HOME = '/mutated';

  expect(result.environment).toEqual({ HOME: '/home/agent', VAR: 'value', SECRET: 'value' });
  expect(Object.isFrozen(result.environment)).toBe(true);
  expect(Object.isFrozen(result.secretValues)).toBe(true);
});

test('rejects hostile reflective-access traps without throwing', () => {
  const throwingArray = new Proxy([], {
    ownKeys: () => {
      throw new Error('hostile trap');
    },
  });
  expect(() =>
    captureChildEnvironment({ inherit: throwingArray, variables: {}, secrets: {} }, {}),
  ).not.toThrow();
  expect(
    captureChildEnvironment({ inherit: throwingArray, variables: {}, secrets: {} }, {}),
  ).toEqual({ status: 'rejected', reason: 'invalid_request' });

  const accessorHostSnapshot = {};
  Object.defineProperty(accessorHostSnapshot, 'HOME', { enumerable: true, get: () => 'value' });
  expect(
    captureChildEnvironment(
      { inherit: ['HOME'], variables: {}, secrets: {} },
      accessorHostSnapshot,
    ),
  ).toEqual({ status: 'rejected', reason: 'missing_inherit_variable' });

  const throwingHostSnapshot = new Proxy(
    {},
    {
      getOwnPropertyDescriptor: () => {
        throw new Error('hostile trap');
      },
    },
  );
  expect(() =>
    captureChildEnvironment(
      { inherit: ['HOME'], variables: {}, secrets: {} },
      throwingHostSnapshot,
    ),
  ).not.toThrow();

  const accessorMetadata = {};
  Object.defineProperty(accessorMetadata, 'inherit', { enumerable: true, get: () => ['HOME'] });
  expect(captureChildEnvironment(accessorMetadata, { HOME: '/home/agent' })).toEqual({
    status: 'rejected',
    reason: 'invalid_request',
  });
});

test('rejects a non-dense inherit array as an invalid request', () => {
  const arrayLikeWithExtraKey: string[] = ['HOME'];
  Object.defineProperty(arrayLikeWithExtraKey, 'extra', {
    value: 'PATH',
    enumerable: true,
    configurable: true,
    writable: true,
  });

  expect(
    captureChildEnvironment(
      { inherit: arrayLikeWithExtraKey, variables: {}, secrets: {} },
      { HOME: '/home/agent' },
    ),
  ).toEqual({ status: 'rejected', reason: 'invalid_request' });
});

test('rejects a non-plain-object value for variables or secrets as an invalid request', () => {
  expect(captureChildEnvironment({ inherit: [], variables: new Date(), secrets: {} }, {})).toEqual({
    status: 'rejected',
    reason: 'invalid_request',
  });
  expect(captureChildEnvironment({ inherit: [], variables: {}, secrets: new Date() }, {})).toEqual({
    status: 'rejected',
    reason: 'invalid_request',
  });
});

test('rejects a non-plain-object top-level request as an invalid request', () => {
  expect(captureChildEnvironment(42, {})).toEqual({
    status: 'rejected',
    reason: 'invalid_request',
  });
});

test('rejects a request object with an unexpected extra top-level key', () => {
  expect(
    captureChildEnvironment({ inherit: [], variables: {}, secrets: {}, extra: 1 }, {}),
  ).toEqual({ status: 'rejected', reason: 'invalid_request' });
});
