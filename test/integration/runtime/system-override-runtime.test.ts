import { expect, test } from 'vitest';

import { createAgentManager, discoverAgents } from '../../../src/index.js';
import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import { invocationOutputDirectory } from '../../support/builders/public-agent-manager.js';
import { systemExecutable } from '../../support/fixtures/system-executable.js';
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

const systemAcpStories = Object.freeze([
  {
    agent: { id: 'gemini-acp', version: '1.0.0' },
    executableBehavior: 'gemini-acp' as const,
    invocationId: 'gemini-system-acp-success',
    launchArgument: '--acp',
    providerId: 'gemini' as const,
  },
  {
    agent: { id: 'opencode-acp', version: '1.0.0' },
    executableBehavior: 'opencode-acp' as const,
    invocationId: 'opencode-system-acp-success',
    launchArgument: 'acp',
    providerId: 'opencode' as const,
  },
]);

const disabledProvidersExcept = (
  selected: (typeof builtInProviderIds)[number],
): readonly (typeof builtInProviderIds)[number][] =>
  builtInProviderIds.filter((id) => id !== selected);

const strictOkResultSchema = Object.freeze({
  additionalProperties: false,
  properties: Object.freeze({ ok: Object.freeze({ const: true, type: 'boolean' }) }),
  required: Object.freeze(['ok']),
  type: 'object',
});

test('keeps an override provider failure bounded and never changes the selected source', async () => {
  await withTemporaryDirectory(async (directory) => {
    const executable = await systemExecutable('auth-failure');
    try {
      const discovery = await discoverAgents({
        disabledDetectorIds: builtInProviderIds.filter((id) => id !== 'codex'),
        systemExecutableOverrides: { codex: executable.executable },
      });
      const definition = discovery.definitions[0];
      expect(definition?.launch).toMatchObject({ command: executable.executable, args: [] });

      const manager = createAgentManager({
        activeStateSink: noOpActiveStateSink,
        definitions: discovery.definitions,
      });
      try {
        await manager.initialize([]);
        const result = await (
          await manager.start({
            agent: { id: 'codex-acp', version: '1.7.0' },
            invocationId: 'selected-override-auth-failure',
            output: {
              directory: invocationOutputDirectory(directory, 'selected-override-auth-failure'),
            },
            parameters: {},
            permissions: {},
            prompt: 'Return a JSON object.',
            result: { schema: { type: 'object' } },
            workspace: { directory },
          })
        ).result();

        expect(result).toMatchObject({
          error: { code: 'revo.agent.protocol_failed', phase: 'execution' },
          launch: { executable: executable.executable, reportedVersion: '1.0.0' },
          status: 'failed',
        });
        expect(JSON.stringify(result)).not.toContain('fixture-secret');
      } finally {
        await manager.shutdown();
      }
    } finally {
      await executable.dispose();
    }
  });
});

for (const story of systemAcpStories) {
  test(`runs a discovered ${story.agent.id} definition through the shared public ACP flow`, async () => {
    await withTemporaryDirectory(async (directory) => {
      const executable = await systemExecutable(story.executableBehavior);
      try {
        const discovery = await discoverAgents({
          disabledDetectorIds: disabledProvidersExcept(story.providerId),
          systemExecutableOverrides: { [story.providerId]: executable.executable },
        });
        const definition = discovery.definitions[0];
        expect(definition?.launch).toMatchObject({
          args: [{ kind: 'literal', value: story.launchArgument }],
          command: executable.executable,
        });

        const manager = createAgentManager({
          activeStateSink: noOpActiveStateSink,
          definitions: discovery.definitions,
        });
        try {
          await manager.initialize([]);
          const result = await (
            await manager.start({
              agent: story.agent,
              invocationId: story.invocationId,
              output: {
                directory: invocationOutputDirectory(directory, story.invocationId),
              },
              parameters: {},
              permissions: {},
              prompt: 'Return exactly {"ok":true}.',
              result: { schema: strictOkResultSchema },
              workspace: { directory },
            })
          ).result();

          expect(result).toMatchObject({
            launch: { executable: executable.executable, reportedVersion: '1.0.0' },
            status: 'succeeded',
          });
        } finally {
          await manager.shutdown();
        }
      } finally {
        await executable.dispose();
      }
    });
  });
}
