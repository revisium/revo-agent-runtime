import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { createAgentManager } from '../../../src/index.js';
import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import { invocationOutputDirectory } from '../../support/builders/public-agent-manager.js';
import { fakeAcpDefinition } from '../../support/fakes/fake-acp.js';
import { noOpActiveStateSink } from '../../support/stories/active-state.js';

type AcpFrame = Readonly<Record<string, unknown>>;

interface AcpWireTrace {
  readonly closeReceived: boolean;
  readonly exited: boolean;
  readonly inbound: readonly AcpFrame[];
  readonly outbound: readonly AcpFrame[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isFrames = (value: unknown): value is readonly AcpFrame[] =>
  Array.isArray(value) && value.every(isRecord);

const readTrace = async (path: string): Promise<AcpWireTrace> => {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    !isRecord(value) ||
    !isFrames(value.inbound) ||
    !isFrames(value.outbound) ||
    typeof value.closeReceived !== 'boolean' ||
    typeof value.exited !== 'boolean'
  )
    throw new TypeError('Invalid fake ACP wire trace.');
  return {
    closeReceived: value.closeReceived,
    exited: value.exited,
    inbound: value.inbound,
    outbound: value.outbound,
  };
};

const request = (directory: string) => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId: 'wire-replay',
  output: { directory: invocationOutputDirectory(directory, 'wire-replay') },
  parameters: {},
  permissions: {},
  prompt: 'Return the fake result.',
  result: { schema: { type: 'object' } },
  workspace: { directory },
});

test('rejects and reaps a bridge that emits an oversized newline-free ACP frame', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'oversized-frame' })],
      limits: { maxStdoutBytes: 65_536 },
    });
    await manager.initialize([]);

    const result = await (await manager.start(request(directory))).result();
    await manager.shutdown();

    expect(result).toMatchObject({
      error: { code: 'revo.agent.protocol_failed' },
      status: 'failed',
    });
    expect(result.exit.code !== null || result.exit.signal !== null).toBe(true);
  });
});

test('delivers the complete ACP invocation contract and publishes advertised usage', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'invocation-contract.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'usage-result', traceFile, usage: true })],
    });
    await manager.initialize([]);

    const invocation = request(directory);
    const result = await (
      await manager.start({
        ...invocation,
        parameters: { mode: 'structured' },
        permissions: { filesystem: 'read-only' },
        result: {
          schema: {
            additionalProperties: true,
            properties: { answer: { type: 'string' } },
            required: ['answer'],
            type: 'object',
          },
        },
      })
    ).result();
    const trace = await readTrace(traceFile);
    await manager.shutdown();

    const prompt = trace.inbound.find((frame) => frame.method === 'session/prompt');
    expect(prompt).toMatchObject({
      params: {
        prompt: [
          {
            text:
              'Return the fake result.\n\nRevo invocation contract (JSON):\n' +
              '{"parameters":{"mode":"structured"},"permissions":{"filesystem":"read-only"},"resultSchema":{"additionalProperties":true,"properties":{"answer":{"type":"string"}},"required":["answer"],"type":"object"}}\n' +
              'Honor the parameters and permission constraints. Return exactly one JSON object matching resultSchema, without markdown or surrounding text.',
            type: 'text',
          },
        ],
      },
    });
    expect(result).toMatchObject({
      status: 'succeeded',
      usage: { inputTokens: 21, outputTokens: 8, totalTokens: 29 },
    });
  });
});
