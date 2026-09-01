import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createAgentManager,
  type AgentConfigurationSelection,
  type AgentManagerLimits,
  type AgentStartContext,
} from '../../../src/index.js';
import { waitForFile } from '../assertions/file-observation.js';
import { publicInvocationRequest } from '../builders/public-agent-manager.js';
import { fakeAcpDefinition } from '../fakes/fake-acp.js';
import { noOpActiveStateSink } from './active-state.js';

interface ConfigurationStoryOptions {
  readonly command?: string;
  readonly definitionId?: string;
  readonly limits?: AgentManagerLimits;
  readonly mode?: string;
  readonly stateful?: boolean;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const inboundFrames = async (
  traceFile: string,
): Promise<readonly Readonly<Record<string, unknown>>[]> => {
  const trace: unknown = JSON.parse(await readFile(traceFile, 'utf8'));
  if (
    typeof trace !== 'object' ||
    trace === null ||
    !('inbound' in trace) ||
    !Array.isArray(trace.inbound)
  )
    throw new TypeError('Invalid configuration story trace.');
  return trace.inbound.flatMap((frame: unknown) => (record(frame) ? [frame] : []));
};

const requestMethods = async (traceFile: string): Promise<readonly string[]> =>
  (await inboundFrames(traceFile)).flatMap((frame) =>
    typeof frame.method === 'string' ? [frame.method] : [],
  );

const configuredSelectValues = async (
  traceFile: string,
): Promise<readonly Readonly<Record<string, unknown>>[]> => {
  return (await inboundFrames(traceFile)).flatMap((frame) => {
    if (frame.method !== 'session/set_config_option' || !record(frame.params)) return [];
    return [frame.params];
  });
};

export const configurationStory = (directory: string, options: ConfigurationStoryOptions = {}) => {
  const traceFile = join(directory, 'configuration.trace.json');
  const stateFile = join(directory, 'configuration-state.json');
  const readyFile = join(directory, 'configuration.ready');
  const definitionId = options.definitionId ?? 'codex';
  const mode = options.mode ?? 'configuration';
  const manager = createAgentManager({
    activeStateSink: noOpActiveStateSink,
    definitions: [
      fakeAcpDefinition({
        ...(options.command === undefined ? {} : { command: options.command }),
        id: definitionId,
        mode,
        ...(mode === 'configuration-hang' ? { readyFile } : {}),
        ...(options.stateful === true ? { configurationStateFile: stateFile } : {}),
        traceFile,
      }),
    ],
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  return Object.freeze({
    changeCatalogModel: (model: string) => writeFile(stateFile, JSON.stringify({ model }), 'utf8'),
    initialize: () => manager.initialize([]),
    inspect: (context?: AgentStartContext) =>
      manager.inspectConfiguration(
        {
          agent: { id: definitionId, version: '1.0.0' },
          workspace: { directory },
        },
        context,
      ),
    beginBlockedInspection: () => {
      const cancellation = new AbortController();
      return Object.freeze({
        cancel: () => cancellation.abort(),
        ready: () => waitForFile(readyFile),
        result: manager.inspectConfiguration(
          {
            agent: { id: definitionId, version: '1.0.0' },
            workspace: { directory },
          },
          { signal: cancellation.signal },
        ),
      });
    },
    observedRequestMethods: () => requestMethods(traceFile),
    observedSelectValues: () => configuredSelectValues(traceFile),
    run: async (configuration: AgentConfigurationSelection, invocationId: string) =>
      (
        await manager.start({
          ...publicInvocationRequest(directory, invocationId),
          configuration,
          workspace: { directory },
        })
      ).result(),
    shutdown: () => manager.shutdown(),
  });
};

export const grokFallbackStory = async (directory: string) => {
  const executable = join(directory, 'fake-grok.mjs');
  await writeFile(
    executable,
    `#!${process.execPath}\n` +
      `import { spawnSync } from 'node:child_process';\n` +
      `const [command, ...args] = process.argv.slice(2);\n` +
      `if (command === '--version') console.log('v1.0.0');\n` +
      `else if (command === 'models') console.log('Default model: grok-4.6\\n\\nAvailable models:\\n  * grok-4.6 (default)\\n  - grok-4.5');\n` +
      `else process.exit(spawnSync(process.execPath, [command, ...args], { stdio: 'inherit' }).status ?? 1);\n`,
    'utf8',
  );
  await chmod(executable, 0o755);
  return configurationStory(directory, {
    command: executable,
    definitionId: 'grok-acp',
    mode: 'success',
  });
};
