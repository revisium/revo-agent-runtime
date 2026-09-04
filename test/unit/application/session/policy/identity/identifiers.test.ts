import { describe, expect, test } from 'vitest';

import {
  continuationId,
  interactionRequestId,
  sessionId,
  turnId,
} from '../../../../../../src/application/session/policy/identity/identifiers.js';
import { AgentManagerError } from '../../../../../../src/contracts/manager.js';

describe('session identifiers', () => {
  test.each([
    [sessionId, 'dlg_01'],
    [turnId, 'trn_01'],
    [interactionRequestId, 'req_01'],
    [continuationId, 'tok_01'],
    [sessionId, 'dialog-😀'],
  ] as const)('owns a bounded identifier', (decode, value) => {
    expect(decode(value)).toBe(value);
  });

  test.each([undefined, '', '\0', '\ud800', '\udc00', 'x'.repeat(257)])(
    'rejects invalid identifier %s',
    (value) => {
      expect(() => sessionId(value)).toThrow(AgentManagerError);
    },
  );
});
