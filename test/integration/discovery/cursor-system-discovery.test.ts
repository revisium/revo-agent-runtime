import { expect, test } from 'vitest';

import { createAgentManager, discoverAgents } from '../../../src/index.js';
import { adjacentNodePackage } from '../../support/builders/adjacent-node-package.js';
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

test('probes a discovered Cursor adjacent Node package through the public manager', async () => {
  const fixture = await adjacentNodePackage();
  try {
    const discovery = await discoverAgents({
      disabledDetectorIds: builtInProviderIds.filter((id) => id !== 'cursor'),
      systemExecutableOverrides: { cursor: fixture.launcher },
    });
    expect(discovery.definitions[0]?.launch).toMatchObject({
      args: [
        { kind: 'literal', value: fixture.entrypoint },
        { kind: 'literal', value: 'acp' },
      ],
      command: fixture.node,
    });
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: discovery.definitions,
    });
    try {
      await manager.initialize([]);
      await expect(
        manager.probeAgent({ id: 'cursor-acp', version: '1.0.0' }),
      ).resolves.toMatchObject({
        reportedVersion: '2026.08.11-e8db854',
        status: 'available',
      });
    } finally {
      await manager.shutdown();
    }
  } finally {
    await fixture.dispose();
  }
});
