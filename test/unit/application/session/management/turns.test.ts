import { expect, test } from 'vitest';

import { ManagedSessionTurns } from '../../../../../src/application/session/management/turns.js';
import type { AgentSessionTurnResult } from '../../../../../src/contracts/session.js';

test('a rejected result removes its running lookup rather than leaving a phantom active turn', async () => {
  const turns = new ManagedSessionTurns({ maxCompletedTurns: 1, maxCompletedTurnBytes: 1_024 });
  const result = Promise.withResolvers<AgentSessionTurnResult>();
  turns.add({
    sessionId: 'dlg_rejected',
    turnId: 'trn_rejected',
    result: () => result.promise,
    cancel: async () => ({ state: 'session_terminal' }),
  });
  expect(turns.inspect('dlg_rejected', 'trn_rejected')?.state).toBe('running');

  result.reject(new Error('Unexpected result rejection.'));
  await expect(result.promise).rejects.toThrow('Unexpected result rejection.');

  expect(turns.get('dlg_rejected', 'trn_rejected')).toBeUndefined();
  expect(turns.inspect('dlg_rejected', 'trn_rejected')).toBeUndefined();
});
