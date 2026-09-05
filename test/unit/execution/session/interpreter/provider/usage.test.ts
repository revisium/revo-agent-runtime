import { expect, it } from 'vitest';

import { SessionUsageAccumulator } from '../../../../../../src/execution/session/interpreter/provider/usage.js';

it('preserves absent counters while making observed provider counters monotonic', () => {
  const usage = new SessionUsageAccumulator({ scope: 'session_cumulative' });
  expect(usage.observe({ inputTokens: 3 })).toEqual({
    inputTokens: 3,
    scope: 'session_cumulative',
  });
  expect(usage.observe({})).toEqual({
    inputTokens: 3,
    scope: 'session_cumulative',
  });
  expect(usage.observe({ inputTokens: 2, outputTokens: 4 })).toEqual({
    inputTokens: 3,
    outputTokens: 4,
    scope: 'session_cumulative',
  });
});

it('combines every optional baseline and provider counter independently', () => {
  const empty = new SessionUsageAccumulator({ scope: 'session_cumulative' });
  expect(empty.observe({})).toEqual({ scope: 'session_cumulative' });

  const baseline = new SessionUsageAccumulator({
    inputTokens: 5,
    outputTokens: 7,
    scope: 'session_cumulative',
    totalTokens: 12,
  });
  expect(baseline.observe({})).toEqual({
    inputTokens: 5,
    outputTokens: 7,
    scope: 'session_cumulative',
    totalTokens: 12,
  });
  expect(baseline.observe({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })).toEqual({
    inputTokens: 7,
    outputTokens: 10,
    scope: 'session_cumulative',
    totalTokens: 17,
  });
});
