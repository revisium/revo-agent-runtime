import { expect, test } from 'vitest';

import { createAgentManager, discoverAgents } from '../../../src/index.js';
import {
  systemExecutable,
  type ExecutableBehavior,
} from '../../support/fixtures/system-executable.js';
import { noOpActiveStateSink } from '../../support/stories/active-state.js';

const builtInProviderIds = Object.freeze([
  'antigravity',
  'claude',
  'cline',
  'codex',
  'copilot',
  'cursor',
  'gemini',
  'goose',
  'grok',
  'hermes',
  'kilo',
  'kimi',
  'opencode',
  'qwen',
  'vibe',
] as const);

type NativeProvider = 'antigravity' | 'goose' | 'hermes';

test.each([
  ['antigravity', 'antigravity-version', 'agy_acp_server_20260818_01_RC01'],
  ['goose', 'goose-version', '1.48.0'],
  ['hermes', 'hermes-version', '0.19.0'],
] as const)(
  'probes %s through its discovered public manager definition',
  async (provider: NativeProvider, behavior: ExecutableBehavior, reportedVersion: string) => {
    const fixture = await systemExecutable(behavior);
    try {
      const discovery = await discoverAgents({
        disabledDetectorIds: builtInProviderIds.filter((id) => id !== provider),
        systemExecutableOverrides: { [provider]: fixture.executable },
      });
      const manager = createAgentManager({
        activeStateSink: noOpActiveStateSink,
        definitions: discovery.definitions,
      });
      try {
        await manager.initialize([]);
        await expect(
          manager.probeAgent({ id: `${provider}-acp`, version: '1.0.0' }),
        ).resolves.toMatchObject({
          reportedVersion,
          status: 'available',
        });
      } finally {
        await manager.shutdown();
      }
    } finally {
      await fixture.dispose();
    }
  },
);
