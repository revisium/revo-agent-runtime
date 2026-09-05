import { expect, test } from 'vitest';

import { formatSessionSmokeEvidence } from '../../smoke/session/evidence.js';

test('prints only bounded normalized session evidence', () => {
  expect(
    formatSessionSmokeEvidence({
      cleanup: 'confirmed',
      eventCount: 12,
      nonceMatched: true,
      providerId: 'codex-acp',
      resume: 'unsupported',
      turnStatuses: ['completed', 'completed'],
    }),
  ).toBe(
    'codex-acp: turns=completed,completed; events=12; nonceMatched=true; cleanup=confirmed; resume=unsupported',
  );
});

test('formats cancellation evidence without provider output', () => {
  expect(
    formatSessionSmokeEvidence({
      cleanup: 'confirmed',
      eventCount: 5,
      providerId: 'claude-acp',
      status: 'cancelled',
    }),
  ).toBe('claude-acp-cancel: status=cancelled; events=5; cleanup=confirmed');
});

test('formats sequential interaction evidence without response values', () => {
  expect(
    formatSessionSmokeEvidence({
      cleanup: 'confirmed',
      eventCount: 9,
      interactionKinds: ['permission', 'input'],
      providerId: 'fake-acp',
      resolvedCount: 2,
      status: 'completed',
    }),
  ).toBe(
    'fake-acp-interactions: status=completed; requests=permission,input; resolved=2; events=9; cleanup=confirmed',
  );
});
