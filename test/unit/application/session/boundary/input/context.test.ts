import { expect, test } from 'vitest';

import { captureSessionLaunchContext } from '../../../../../../src/application/session/boundary/input/context.js';

const thrownBy = (operation: () => unknown): unknown => {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to throw.');
};

test('captures an immutable session environment and preserves its abort signal', () => {
  const controller = new AbortController();

  const captured = captureSessionLaunchContext(
    {
      environment: {
        inherit: ['LANG'],
        secrets: { API_TOKEN: 'hidden' },
        variables: { MODE: 'test' },
      },
      signal: controller.signal,
    },
    { LANG: 'C.UTF-8' },
  );

  expect(captured).toEqual({
    environment: {
      secrets: ['hidden'],
      values: { API_TOKEN: 'hidden', LANG: 'C.UTF-8', MODE: 'test' },
    },
    signal: controller.signal,
  });
  expect(Object.isFrozen(captured.environment.values)).toBe(true);
});

test('rejects a pre-aborted session opening context', () => {
  const controller = new AbortController();
  controller.abort();

  expect(
    thrownBy(() => captureSessionLaunchContext({ signal: controller.signal }, {})),
  ).toMatchObject({ fault: { code: 'revo.agent.cancelled' } });
});

test('normalizes invalid session environments to a public definition fault', () => {
  expect(
    thrownBy(() =>
      captureSessionLaunchContext(
        {
          environment: {
            inherit: ['MISSING'],
            secrets: {},
            variables: {},
          },
        },
        {},
      ),
    ),
  ).toMatchObject({ fault: { code: 'revo.agent.definition_invalid' } });
});
