export const packedConsumerRuntime = (packageName: string, fakeAcpBridge: string): string => `
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import * as runtime from '${packageName}';

assert.deepEqual(Object.keys(runtime), ['AgentManagerError', 'createAgentManager', 'discoverAgents']);
await assert.rejects(
  import('${packageName}/dist/index.js'),
  (error) => error instanceof Error && 'code' in error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
);
await assert.rejects(
  import('${packageName}/dist/contracts/session.js'),
  (error) => error instanceof Error && 'code' in error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
);
await assert.rejects(
  import('${packageName}/test/support/fake-native-protocol-driver.js'),
  (error) => error instanceof Error && 'code' in error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
);

const require = createRequire(import.meta.url);
for (const name of ['@openai/codex', '@anthropic-ai/claude-agent-sdk', '@agentclientprotocol/codex-acp', '@agentclientprotocol/claude-agent-acp']) {
  assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' });
}
const disabledDetectorIds = ['antigravity', 'cline', 'copilot', 'cursor', 'gemini', 'goose', 'grok', 'hermes', 'kilo', 'kimi', 'opencode', 'qwen', 'vibe'];
const originalPath = process.env.PATH;
try {
  process.env.PATH = '';
  const missing = await runtime.discoverAgents({ disabledDetectorIds });
  assert.deepEqual(missing.definitions, []);
  assert.deepEqual(missing.diagnostics.map(({ code }) => code), ['system_executable_unavailable', 'system_executable_unavailable']);
} finally {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
}
const discovered = await runtime.discoverAgents({
  disabledDetectorIds,
  systemExecutableOverrides: { codex: process.execPath, claude: process.execPath },
});
assert.deepEqual(discovered.definitions.map(({ id, version }) => [id, version]), [
  ['claude-acp', '0.70.0'], ['codex-acp', '1.7.0'],
]);
for (const definition of discovered.definitions) {
  assert.equal(definition.launch.command, process.execPath);
  assert.equal(definition.launch.versionProbe.command, process.execPath);
  const entrypoint = definition.launch.args[0]?.value;
  assert.equal(typeof entrypoint, 'string');
  assert.ok(isAbsolute(entrypoint));
  const variable = definition.id === 'codex-acp' ? 'CODEX_PATH' : 'CLAUDE_CODE_EXECUTABLE';
  assert.equal(definition.launch.environment[variable], process.execPath);
  const reported = execFileSync(process.execPath, [entrypoint, '--version'], { env: {}, encoding: 'utf8', shell: false }).trim();
  assert.equal(reported, definition.id === 'codex-acp' ? '@agentclientprotocol/codex-acp ' + definition.version : definition.version);
}
const invalid = await runtime.discoverAgents({ disabledDetectorIds, systemExecutableOverrides: { claude: process.cwd(), codex: 'relative-codex' } });
assert.deepEqual(invalid.definitions, []);
assert.deepEqual(invalid.diagnostics.map(({ code }) => code), ['system_override_unavailable', 'system_override_unavailable']);

const bridgePath = fileURLToPath(new URL('./fake-acp-bridge.mjs', import.meta.url));
await writeFile(bridgePath, ${JSON.stringify(fakeAcpBridge)}, 'utf8');

const manager = runtime.createAgentManager({
  activeStateSink: { remove: async () => undefined, save: async () => undefined },
  definitions: [
    {
      schemaVersion: 'agent-definition/v1',
      id: 'fake',
      version: '1',
      displayName: 'Fake ACP',
      launch: {
        command: process.execPath,
        args: [{ kind: 'literal', value: bridgePath }],
        versionProbe: { args: ['--version'], prefix: 'v', stream: 'stdout', timeoutMs: 1000 },
      },
      protocol: { driver: 'acp/v1', permissionStrategy: 'acp/v1' },
      delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'protocol' },
      parameters: { schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } },
      permissions: { schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } },
      capabilities: { cancellation: true, structuredResult: true, usage: false },
    },
  ],
});
await manager.initialize([]);
const configuration = await manager.inspectConfiguration({
  agent: { id: 'fake', version: '1' },
  workspace: { directory: process.cwd() },
});
assert.equal(configuration.schemaVersion, 'agent-configuration-catalog/v1');
assert.equal(configuration.model?.currentModel, 'packed/model');
assert.deepEqual(configuration.options.map(({ id, currentValue }) => [id, currentValue]), [
  ['model', 'packed/model'],
]);
const outputDirectory = join(process.cwd(), 'invocation-output');
const handle = await manager.start({
  agent: { id: 'fake', version: '1' },
  configuration: {
    catalogRevision: configuration.catalogRevision,
    selections: { model: 'packed/model' },
  },
  invocationId: 'packed-consumer-invocation',
  output: { directory: outputDirectory },
  parameters: {},
  permissions: {},
  prompt: 'Return the fake result.',
  result: { schema: { type: 'object' } },
  workspace: { directory: process.cwd() },
});
const result = await handle.result();
assert.equal(result.schemaVersion, 'agent-invocation-result/v1');
assert.equal(result.invocationId, 'packed-consumer-invocation');
assert.deepEqual(result.pin, handle.pin);
assert.deepEqual(result.launch, {
  executable: process.execPath,
  reportedVersion: process.versions.node,
});
assert.equal(result.durationMs, Date.parse(result.finishedAt) - Date.parse(result.acceptedAt));
assert.ok(result.startedAt === undefined || Date.parse(result.startedAt) >= Date.parse(result.acceptedAt));
assert.deepEqual(result.exit, process.platform === 'win32'
  ? { code: 1, signal: null }
  : { code: null, signal: 'SIGTERM' });
assert.deepEqual(result.files, {
  directory: outputDirectory,
  events: 'events.ndjson',
  result: 'result.json',
  stderr: 'stderr.log',
  stdout: 'stdout.log',
});
assert.equal(result.status, 'succeeded');
if (result.status !== 'succeeded') throw new Error('Packed invocation did not succeed.');
assert.deepEqual(result.value, { answer: 'packed consumer' });
await manager.shutdown();
`;
