import { afterEach, expect, test, vi } from 'vitest';

import { createNamedHostEnvironmentSnapshot } from '../../../../src/application/manager/create-named-host-environment-snapshot.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

test('copies only present named host variables into a frozen null-prototype snapshot', () => {
  vi.stubEnv('PATH', '/fixture/bin');
  vi.stubEnv('HOME', '/fixture/home');
  vi.stubEnv('TMPDIR', undefined);
  vi.stubEnv('LANG', undefined);
  vi.stubEnv('REVO_TEST_MARKER', 'leak');

  const snapshot = createNamedHostEnvironmentSnapshot(['PATH', 'HOME', 'TMPDIR', 'LANG']);

  expect(Object.keys(snapshot)).toEqual(['PATH', 'HOME']);
  expect(snapshot).toEqual({ PATH: '/fixture/bin', HOME: '/fixture/home' });
  expect(Object.getPrototypeOf(snapshot)).toBeNull();
  expect(Object.isFrozen(snapshot)).toBe(true);
});
