import { expect, test } from 'vitest';

import { createAgentManager, discoverAgents } from '../../../src/index.js';
import { nodePackageEntrypoint } from '../../support/builders/node-package-entrypoint.js';
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

test('probes a discovered Copilot Node entrypoint through the public manager', async () => {
  const fixture = await nodePackageEntrypoint(
    { binName: 'copilot', command: 'copilot', packageName: '@github/copilot' },
    'valid',
    {
      versionDelayMs: 1_200,
      versionOutput: 'GitHub Copilot CLI 1.0.82.\nUpdate available.\n',
    },
  );
  try {
    const discovery = await discoverAgents({
      disabledDetectorIds: builtInProviderIds.filter((id) => id !== 'copilot'),
      systemExecutableOverrides: { copilot: fixture.packageBin },
    });
    expect(discovery.definitions).toHaveLength(1);
    expect(discovery.definitions[0]?.launch).toMatchObject({
      args: [
        { kind: 'literal', value: fixture.entrypoint },
        { kind: 'literal', value: '--acp' },
        { kind: 'literal', value: '--stdio' },
      ],
      command: process.execPath,
    });

    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: discovery.definitions,
    });
    try {
      await manager.initialize([]);
      await expect(
        manager.probeAgent({ id: 'copilot-acp', version: '1.0.0' }),
      ).resolves.toMatchObject({
        reportedVersion: '1.0.82.',
        status: 'available',
      });
    } finally {
      await manager.shutdown();
    }
  } finally {
    await fixture.dispose();
  }
});

test('bounds a delayed Copilot version probe through the public manager', async () => {
  const fixture = await nodePackageEntrypoint(
    { binName: 'copilot', command: 'copilot', packageName: '@github/copilot' },
    'valid',
    {
      versionDelayMs: 5_250,
      versionOutput: 'GitHub Copilot CLI 1.0.82.\n',
    },
  );
  try {
    const discovery = await discoverAgents({
      disabledDetectorIds: builtInProviderIds.filter((id) => id !== 'copilot'),
      systemExecutableOverrides: { copilot: fixture.packageBin },
    });
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: discovery.definitions,
    });
    try {
      await manager.initialize([]);
      await expect(
        manager.probeAgent({ id: 'copilot-acp', version: '1.0.0' }),
      ).resolves.toMatchObject({
        error: { code: 'revo.agent.probe_timeout', phase: 'probing' },
        status: 'unavailable',
      });
    } finally {
      await manager.shutdown();
    }
  } finally {
    await fixture.dispose();
  }
}, 10_000);
