import { expect, test } from 'vitest';

import { createSessionInterpreterResources } from '../../../../../../src/execution/session/interpreter/provider/opening/resources.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';

const correlation = { effectId: 'prepare', epoch: 1, sessionId: 'session_01' } as const;

test('disposes native instructions only after confirmed process teardown', async () => {
  const confirmed = { count: 0 };
  const uncertain = { count: 0 };
  const resources = createSessionInterpreterResources();
  const register = (id: string, sessionId: string, bucket: { count: number }) => {
    expect(
      resources.preparations.register(id, {
        correlation: { ...correlation, sessionId },
        opening: sessionOpeningCommand().opening,
        output: {
          dispose: () => undefined,
          writeStderr: () => undefined,
          writeStdout: () => undefined,
        } as never,
        prepared: {
          instructions: {
            artifact: {
              dispose: async () => {
                bucket.count += 1;
              },
              path: '/output/revo-opencode-instructions.md',
            },
          },
        } as never,
      }),
    ).toBe(true);
  };

  register('preparation-confirmed', 'session_confirmed', confirmed);
  register('preparation-uncertain', 'session_uncertain', uncertain);
  resources.preparations.release({ ...correlation, sessionId: 'session_uncertain' }, false);
  resources.preparations.release({ ...correlation, sessionId: 'session_confirmed' }, true);
  await Promise.resolve();

  expect(uncertain.count).toBe(0);
  expect(confirmed.count).toBe(1);
});
