import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { execa } from 'execa';

import { createAgentManager, discoverAgents } from '../../src/index.js';
import { builtInProviderIds } from './support/provider-selection.js';

// Test installations only: these versions never enter the runtime dependency graph.
const versions = { codex: '0.153.3', claude: '2.1.263' };
const providers = ['claude', 'codex'] as const;
const directory = await mkdtemp(join(tmpdir(), 'revo-installed-cli-smoke-'));
const originalPath = process.env.PATH;
const selection = {
  disabledDetectorIds: builtInProviderIds.filter((id) => id !== 'codex' && id !== 'claude'),
};

try {
  await execa(
    'npm',
    [
      'install',
      '--prefix',
      directory,
      '--no-save',
      '--no-audit',
      '--no-fund',
      `@openai/codex@${versions.codex}`,
      `@anthropic-ai/claude-code@${versions.claude}`,
    ],
    { timeout: 180_000 },
  );
  process.env.PATH = directory;
  assert.deepEqual((await discoverAgents(selection)).definitions, []);
  process.env.PATH = `${join(directory, 'node_modules', '.bin')}${delimiter}${originalPath ?? ''}`;
  const discovery = await discoverAgents(selection);
  const selectedDefinitions = await Promise.all(
    providers.map(async (provider) => {
      const explicit = await discoverAgents({
        disabledDetectorIds: builtInProviderIds.filter((id) => id !== provider),
        systemExecutableOverrides: {
          [provider]: join(
            directory,
            'node_modules',
            '.bin',
            `${provider}${process.platform === 'win32' ? '.cmd' : ''}`,
          ),
        },
      });
      assert.equal(explicit.definitions.length, 1, JSON.stringify(explicit.diagnostics));
      const definition = explicit.definitions[0];
      assert.ok(definition);
      assert.ok(
        discovery.definitions.some(
          ({ id, installationId }) =>
            id === definition.id && installationId === definition.installationId,
        ),
        JSON.stringify(discovery.diagnostics),
      );
      return definition;
    }),
  );
  const manager = createAgentManager({
    definitions: discovery.definitions,
    activeStateSink: { save: async () => undefined, remove: async () => undefined },
  });
  try {
    await manager.initialize([]);
    await Promise.all(
      selectedDefinitions.map(async (definition) => {
        const provider = definition.id === 'codex-acp' ? 'codex' : 'claude';
        const probe = await manager.probeAgent({
          id: definition.id,
          version: definition.version,
          installationId: definition.installationId,
        });
        assert.equal(probe.status, 'available');
        assert.equal(probe.versionProbeExecutable, definition.launch.versionProbe.command);
        assert.ok(probe.reportedVersion?.startsWith(versions[provider]));
        console.log(
          `${provider}: CLI ${probe.reportedVersion}; adapter ${definition.version}; executable ${probe.versionProbeExecutable}`,
        );
      }),
    );
  } finally {
    await manager.shutdown();
  }
} finally {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  await rm(directory, { recursive: true, force: true });
}
