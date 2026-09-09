import { expect, test } from 'vitest';

import { nodeDiscoveryPlatform } from '../../../../src/platform/node/discovery/platform.js';
import { createCodexDetector } from '../../../../src/providers/codex/detector.js';

test('does not fall back when an explicit CLI override is unavailable', async () => {
  const selected: (string | undefined)[] = [];
  const detector = createCodexDetector(
    { systemExecutableOverrides: { codex: '/missing/codex' } },
    {
      ...nodeDiscoveryPlatform,
      resolveInstalledCli: async (_policy, override) => {
        selected.push(override);
        return undefined;
      },
    },
  );

  const result = await detector.detect({ signal: new AbortController().signal });

  expect(selected).toEqual(['/missing/codex']);
  expect(result.candidates).toEqual([]);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'system_override_unavailable' }),
  );
});

test('reports a missing packaged adapter separately from a missing CLI', async () => {
  const detector = createCodexDetector(
    {},
    {
      ...nodeDiscoveryPlatform,
      resolveInstalledCli: async () => '/installed/codex',
      resolveBundledBridge: () => ({ available: false, reason: 'entrypoint_invalid' }),
    },
  );

  const result = await detector.detect({ signal: new AbortController().signal });

  expect(result.candidates).toEqual([]);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'bundled_bridge_unavailable' }),
  );
});
