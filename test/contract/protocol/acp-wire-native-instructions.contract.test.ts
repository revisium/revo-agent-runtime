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

const instructions = 'Answer in haiku. nonce-7c2e';
const nativeDelivery = {
  channel: 'acp:session/new._meta.systemPrompt.append',
  mode: 'native_append',
} as const;

const claudeLike = (traceFile: string, options: { mode?: string; version?: string } = {}) =>
  fakeAcpDefinition({
    id: 'claude-acp',
    mode: options.mode ?? 'instructions-native',
    session: true,
    traceFile,
    version: options.version ?? '0.70.0',
  });

const request = (directory: string, invocationId: string, version = '0.70.0') => ({
  agent: { id: 'claude-acp', version },
  instructions,
  invocationId,
  output: { directory: invocationOutputDirectory(directory, invocationId) },
  parameters: {},
  permissions: {},
  prompt: 'Return the fake result.',
  result: { schema: { type: 'object' } },
  workspace: { directory },
});

test('an invocation on the pinned Claude bridge appends through _meta and never prefixes or replaces', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'claude.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [claudeLike(traceFile)],
    });
    await manager.initialize([]);
    const result = await (await manager.start(request(directory, 'native'))).result();
    const trace = await readFakeAcpTrace(traceFile);
    await manager.shutdown();

    const sessionNew = inboundParams(trace, 'session/new');
    expect(sessionNew).toEqual({
      _meta: { systemPrompt: { append: instructions } },
      cwd: directory,
      mcpServers: [],
    });
    expect(JSON.stringify(sessionNew)).not.toContain('baseInstructions');
    expect(promptTexts(trace)[0]).toMatch(/^Return the fake result\.\n\nRevo invocation contract/);
    expect(result).toMatchObject({
      instructionsDelivery: nativeDelivery,
      status: 'succeeded',
      value: { meta: instructions },
    });
  });
});

test('another bridge version keeps the delimited prefix and sends no _meta', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'claude-old.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [claudeLike(traceFile, { version: '0.69.0' })],
    });
    await manager.initialize([]);
    const result = await (await manager.start(request(directory, 'prefix', '0.69.0'))).result();
    const trace = await readFakeAcpTrace(traceFile);
    await manager.shutdown();

    expect(inboundParams(trace, 'session/new')).toEqual({ cwd: directory, mcpServers: [] });
    expect(promptTexts(trace)[0]).toMatch(/^<<<REVO_INSTRUCTIONS>>>\n/);
    expect(result).toMatchObject({
      instructionsDelivery: { channel: 'acp:session/prompt.prefix', mode: 'prompt_prefix' },
      value: { meta: null },
    });
  });
});

test('a provider rejecting the native session fails the invocation once without a prefix retry', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'claude-reject.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [claudeLike(traceFile, { mode: 'session-new-reject' })],
    });
    await manager.initialize([]);
    const result = await (await manager.start(request(directory, 'reject'))).result();
    const trace = await readFakeAcpTrace(traceFile);
    await manager.shutdown();

    expect(inboundFrames(trace, 'session/new')).toHaveLength(1);
    expect(inboundFrames(trace, 'session/prompt')).toHaveLength(0);
    expect(result).toMatchObject({
      error: {
        code: 'revo.agent.protocol_failed',
        details: {
          diagnostic: {
            provider: { data: { error: { message: 'Fixture rejects session creation.' } } },
          },
        },
        retryable: false,
      },
      instructionsDelivery: nativeDelivery,
      status: 'failed',
    });
    if (result.status !== 'failed') throw new Error('Expected a failed result.');
    expect(JSON.stringify(result.error)).not.toContain(instructions);
  });
});

test('a session appends natively on open, leaves every prompt unprefixed, and reports the channel once', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'claude-session.trace.json');
    const events: AgentSessionEvent[] = [];
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [claudeLike(traceFile)],
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
    await manager.initialize([]);
    const session = await manager.sessions.open({
      agent: { id: 'claude-acp', version: '0.70.0' },
      instructions,
      output: { directory: join(directory, 'session-output') },
      parameters: {},
      permissions: {},
      sessionId: 'dialogue',
      workspace: { directory },
    });
    const first = await (await session.send({ prompt: 'first', turnId: 'first' })).result();
    await (await session.send({ prompt: 'second', turnId: 'second' })).result();
    await session.close();
    await manager.shutdown();
    const trace = await readFakeAcpTrace(traceFile);

    expect(inboundParams(trace, 'session/new')).toEqual({
      _meta: { systemPrompt: { append: instructions } },
      cwd: directory,
      mcpServers: [],
    });
    expect(promptTexts(trace)).toEqual(['first', 'second']);
    expect(first).toMatchObject({ message: { content: JSON.stringify({ meta: instructions }) } });
    expect(events.find((event) => event.type === 'session.opened')).toMatchObject({
      instructionsDelivery: nativeDelivery,
    });
  });
});

test('a session whose native open is rejected fails to open and is never retried with a prefix', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'claude-session-reject.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [
        claudeLike(traceFile, { mode: 'session-new-reject' }),
        fakeAcpDefinition({ mode: 'session' }),
      ],
      sessions: {
        activeStateSink: {
          remove: async () => ({ state: 'applied' }),
          save: async () => ({ state: 'applied' }),
        },
        eventSink: { append: async () => ({ state: 'appended' }) },
      },
    });
    await manager.initialize([]);
    await expect(
      manager.sessions.open({
        agent: { id: 'claude-acp', version: '0.70.0' },
        instructions,
        output: { directory: join(directory, 'rejected-output') },
        parameters: {},
        permissions: {},
        sessionId: 'rejected',
        workspace: { directory },
      }),
    ).rejects.toMatchObject({
      fault: {
        code: 'revo.agent.protocol_failed',
        message: 'Fixture rejects session creation.',
        retryable: false,
      },
    });
    await manager.shutdown();
    const trace = await readFakeAcpTrace(traceFile);

    expect(inboundFrames(trace, 'session/new')).toHaveLength(1);
    expect(inboundFrames(trace, 'session/prompt')).toHaveLength(0);
  });
});
