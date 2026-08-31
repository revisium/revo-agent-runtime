import { expect, test } from 'vitest';

import { normalizeAcpUsage } from '../../../../src/protocol/acp/usage.js';

test('normalizes the stable public token counters and drops ACP-only metadata', () => {
  const usage = normalizeAcpUsage({
    cachedReadTokens: 5,
    inputTokens: 21,
    outputTokens: 8,
    thoughtTokens: 3,
    totalTokens: 29,
  });

  expect(usage).toEqual({ inputTokens: 21, outputTokens: 8, totalTokens: 29 });
  expect(Object.isFrozen(usage)).toBe(true);
});

test.each([
  null,
  {},
  { inputTokens: -1, outputTokens: 0, totalTokens: 0 },
  { inputTokens: 0, outputTokens: 0.5, totalTokens: 0 },
  { inputTokens: 0, outputTokens: 0, totalTokens: Number.MAX_SAFE_INTEGER + 1 },
])('rejects malformed ACP usage evidence %#', (value) => {
  expect(() => normalizeAcpUsage(value)).toThrow('ACP usage is invalid.');
});
