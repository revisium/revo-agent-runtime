import { expect, it } from 'vitest';

import { SessionUsageAccumulator } from '../../../../../../src/execution/session/interpreter/provider/usage.js';

it('preserves absent counters while making observed provider counters monotonic', () => {
  const usage = new SessionUsageAccumulator({ scope: 'session_cumulative' });
  expect(usage.observe({ inputTokens: 3 })).toEqual({
    inputTokens: 3,
    scope: 'session_cumulative',
  });
  expect(usage.observe({ inputTokens: 2, outputTokens: 4 })).toEqual({
    inputTokens: 3,
    outputTokens: 4,
    scope: 'session_cumulative',
  });
});
