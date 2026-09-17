import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { createAgentManager, type AgentSessionEvent } from '../../../src/index.js';
import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import { invocationOutputDirectory } from '../../support/builders/public-agent-manager.js';
import {
  inboundFrames,
  inboundParams,
  promptTexts,
  readFakeAcpTrace,
} from '../../support/fake-acp/trace.js';
import { fakeAcpDefinition } from '../../support/fakes/fake-acp.js';
import { noOpActiveStateSink } from '../../support/stories/active-state.js';

const instructions = 'Read .revo/index.md before answering. nonce-4f1c';
const prefixed = (prompt: string): string =>
  `<<<REVO_INSTRUCTIONS>>>\n${instructions}\n<<<END_REVO_INSTRUCTIONS>>>\n\n${prompt}`;

const knowledgeServer = {
  name: 'knowledge',
  transport: 'stdio' as const,
  command: 'revo',
  args: ['mcp'],
  env: { TOKEN: { environment: 'FIXTURE_TOKEN' } },
};

const request = (directory: string, invocationId: string) => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId,
  output: { directory: invocationOutputDirectory(directory, invocationId) },
  parameters: {},
  permissions: {},
  prompt: 'Return the fake result.',
  result: { schema: { type: 'object' } },
  workspace: { directory },
});

const sessionManager = (
  definition: ReturnType<typeof fakeAcpDefinition>,
  events: AgentSessionEvent[],
) =>
  createAgentManager({
    activeStateSink: noOpActiveStateSink,
    definitions: [definition],
    sessions: {
      activeStateSink: {
        remove: async () => ({ state: 'applied' }),
        save: async () => ({ state: 'applied' }),
      },
      eventSink: {
        append: async (event) => {
          events.push(event);
          return { state: 'appended' };
        },
      },
    },
  });

test('an invocation prefixes the first prompt, forwards resolved MCP bindings, and redacts them everywhere', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'context.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'literal-secret-result', traceFile })],
    });
    await manager.initialize([]);
    const result = await (
      await manager.start(
        { ...request(directory, 'context'), instructions, mcpServers: [knowledgeServer] },
        {
          environment: { inherit: [], secrets: { FIXTURE_TOKEN: 'literal-secret' }, variables: {} },
        },
      )
    ).result();
    const trace = await readFakeAcpTrace(traceFile);
    await manager.shutdown();

    expect(inboundParams(trace, 'session/new')).toEqual({
      cwd: directory,
      mcpServers: [
        {
          name: 'knowledge',
          command: 'revo',
          args: ['mcp'],
          env: [{ name: 'TOKEN', value: 'literal-secret' }],
        },
      ],
    });
    expect(promptTexts(trace)[0]).toMatch(
      new RegExp(
        `^${prefixed('Return the fake result.').replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n\nRevo invocation contract`,
      ),
    );
    expect(result).toMatchObject({
      instructionsDelivery: { channel: 'acp:session/prompt.prefix', mode: 'prompt_prefix' },
      status: 'succeeded',
    });
    expect(JSON.stringify(result)).not.toContain('literal-secret');
    for (const name of ['stdout.log', 'stderr.log', 'events.ndjson', 'result.json'])
      // oxlint-disable-next-line no-await-in-loop -- reads the published files one by one for a clear failure message
      expect(await readFile(join(result.files.directory, name), 'utf8')).not.toContain(
        'literal-secret',
      );
  });
});

test('empty instructions and a literal MCP value are wire-identical to omission apart from the value', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'omitted.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ traceFile })],
    });
    await manager.initialize([]);
    const result = await (
      await manager.start({ ...request(directory, 'omitted'), instructions: '' })
    ).result();
    const trace = await readFakeAcpTrace(traceFile);
    await manager.shutdown();

    expect(inboundParams(trace, 'session/new')).toEqual({ cwd: directory, mcpServers: [] });
    expect(promptTexts(trace)[0]).toMatch(/^Return the fake result\.\n\nRevo invocation contract/);
    expect(result).not.toHaveProperty('instructionsDelivery');
  });
});

test('an HTTP MCP server the agent cannot reach fails the invocation as invalid parameters', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition()],
    });
    await manager.initialize([]);
    const result = await (
      await manager.start({
        ...request(directory, 'http'),
        mcpServers: [{ name: 'remote', transport: 'http', url: 'https://fixture/mcp' }],
      })
    ).result();
    await manager.shutdown();

    expect(result).toMatchObject({
      error: { code: 'revo.agent.parameters_invalid', phase: 'execution' },
      status: 'failed',
    });
  });
});

test('a missing MCP environment binding fails before any agent process starts', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'missing.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ traceFile })],
    });
    await manager.initialize([]);
    await expect(
      manager.start({ ...request(directory, 'missing'), mcpServers: [knowledgeServer] }),
    ).rejects.toMatchObject({ fault: { code: 'revo.agent.parameters_invalid' } });
    await manager.shutdown();
    await expect(readFile(traceFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

test('a session prefixes only its first turn, reports the delivery once, and redacts MCP values in events', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'session.trace.json');
    const events: AgentSessionEvent[] = [];
    const manager = sessionManager(fakeAcpDefinition({ mode: 'session', traceFile }), events);
    await manager.initialize([]);
    const launch = {
      agent: { id: 'codex', version: '1.0.0' },
      instructions,
      mcpServers: [knowledgeServer],
      output: { directory: join(directory, 'session-output') },
      parameters: {},
      permissions: {},
      sessionId: 'dialogue',
      workspace: { directory },
    };
    await expect(manager.sessions.open(launch)).rejects.toMatchObject({
      fault: { code: 'revo.agent.parameters_invalid' },
    });
    const session = await manager.sessions.open(
      { ...launch, sessionId: 'dialogue-valid' },
      {
        environment: {
          inherit: [],
          secrets: { FIXTURE_TOKEN: 'session-token-value' },
          variables: {},
        },
      },
    );
    const snapshot = manager.sessions.inspect('dialogue-valid');
    const first = await (await session.send({ prompt: 'first', turnId: 'first' })).result();
    await (await session.send({ prompt: 'second', turnId: 'second' })).result();
    await expect(
      session.send({ instructions: 'later', prompt: 'third', turnId: 'third' } as never),
    ).rejects.toMatchObject({ fault: { code: 'revo.agent.parameters_invalid' } });
    await session.close();
    await manager.shutdown();
    const trace = await readFakeAcpTrace(traceFile);

    expect(inboundParams(trace, 'session/new')).toMatchObject({
      mcpServers: [{ name: 'knowledge', env: [{ name: 'TOKEN', value: 'session-token-value' }] }],
    });
    expect(promptTexts(trace)).toEqual([prefixed('first'), 'second']);
    expect(first).toMatchObject({ status: 'completed', message: { content: prefixed('first') } });
    expect(snapshot).toMatchObject({
      instructionsDelivery: { channel: 'acp:session/prompt.prefix', mode: 'prompt_prefix' },
    });
    expect(events.find((event) => event.type === 'session.opened')).toMatchObject({
      instructionsDelivery: { channel: 'acp:session/prompt.prefix', mode: 'prompt_prefix' },
    });
    expect(JSON.stringify(events)).not.toContain('session-token-value');
    expect(inboundFrames(trace, 'session/new')).toHaveLength(1);
  });
});
