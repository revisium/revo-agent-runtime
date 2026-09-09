import { expect, test } from 'vitest';

import { nodeDiscoveryPlatform } from '../../../../src/platform/node/discovery/platform.js';
import { createClaudeDetector } from '../../../../src/providers/claude/detector.js';
import { createCodexDetector } from '../../../../src/providers/codex/detector.js';

const cases = [
  { detector: createCodexDetector, provider: 'codex', variable: 'CODEX_PATH' },
  { detector: createClaudeDetector, provider: 'claude', variable: 'CLAUDE_CODE_EXECUTABLE' },
] as const;

for (const { detector, provider, variable } of cases) {
  test(`${provider} keeps the ACP adapter and binds its selected CLI to version checks and launch`, async () => {
    const cli = `/installed/${provider}`;
    const result = await detector(
      { systemExecutableOverrides: { [provider]: cli } },
      {
        ...nodeDiscoveryPlatform,
        resolveInstalledCli: async () => cli,
      },
    ).detect({ signal: new AbortController().signal });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.definition).toMatchObject({
      protocol: { driver: 'acp/v1' },
      launch: {
        command: process.execPath,
        environment: { [variable]: cli },
        versionProbe: { command: cli, args: ['--version'] },
      },
    });
  });

  test(`${provider} is unavailable when its installed CLI is missing`, async () => {
    const result = await detector(
      {},
      {
        ...nodeDiscoveryPlatform,
        resolveInstalledCli: async () => undefined,
      },
    ).detect({ signal: new AbortController().signal });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'system_executable_unavailable' }),
    );
  });
}
