import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { createAgentManager } from '../../../src/index.js';
import {
  captureProviderDiagnostics,
  type ProviderDiagnosticTrace,
} from '../../smoke/support/provider-diagnostics.js';
import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import { invocationOutputDirectory } from '../../support/builders/public-agent-manager.js';
import { fakeAcpDefinition } from '../../support/fakes/fake-acp.js';
import { noOpActiveStateSink } from '../../support/stories/active-state.js';

const request = (directory: string) => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId: 'diagnostic-case',
  output: { directory: invocationOutputDirectory(directory, 'diagnostic-case') },
  parameters: {},
  permissions: {},
  prompt: 'Ping without tools.',
  result: { schema: { type: 'object' } },
  workspace: { directory },
});

const readTrace = async (path: string): Promise<ProviderDiagnosticTrace> =>
  JSON.parse(await readFile(path, 'utf8')) as ProviderDiagnosticTrace;

test('captures nested ACP error evidence while preserving the generic public fault', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'rpc-error.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'rpc-error', traceFile })],
    });
    await manager.initialize([]);

    const result = await (await manager.start(request(directory))).result();
    const capture = captureProviderDiagnostics({
      agent: { id: 'codex', version: '1.0.0' },
      caseId: 'fake-rpc-error',
      phase: 'prompt',
      publicResult: result,
      trace: await readTrace(traceFile),
    });
    await manager.shutdown();

    expect(result).toMatchObject({
      error: {
        code: 'revo.agent.protocol_failed',
        message: 'The agent protocol did not produce a valid terminal result.',
      },
      status: 'failed',
    });
    expect(capture.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: { provider: { error: { message: 'nested provider failure' }, name: 'claude' } },
          message: 'Provider rejected the prompt.',
          source: 'acp.error',
        }),
        expect.objectContaining({ source: 'runtime.fault' }),
      ]),
    );
  });
});

test('captures stderr in chunks with redaction', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'stderr.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'literal-secret-result', traceFile })],
    });
    await manager.initialize([]);

    const result = await (await manager.start(request(directory))).result();
    const capture = captureProviderDiagnostics({
      agent: { id: 'codex', version: '1.0.0' },
      caseId: 'fake-stderr',
      phase: 'close',
      publicResult: result,
      secrets: ['private-secret'],
      trace: await readTrace(traceFile),
    });
    await manager.shutdown();

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(capture.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'stderr API_KEY=[REDACTED]\n', source: 'stderr' }),
      ]),
    );
    expect(JSON.stringify(capture)).not.toContain('private-secret');
  });
});

test('records EOF and child exit as transport evidence while keeping the public fault stable', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'eof.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'eof', traceFile })],
    });
    await manager.initialize([]);

    const result = await (await manager.start(request(directory))).result();
    const capture = captureProviderDiagnostics({
      agent: { id: 'codex', version: '1.0.0' },
      caseId: 'fake-eof',
      phase: 'prompt',
      publicResult: result,
      trace: await readTrace(traceFile),
    });
    await manager.shutdown();

    expect(result).toMatchObject({
      error: { code: 'revo.agent.protocol_failed' },
      status: 'failed',
    });
    expect(capture.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ code: 0, exited: true }),
          source: 'exit',
        }),
      ]),
    );
  });
});

test('bounds and redacts diagnostic frames without classifying ordinary content', () => {
  const cyclic: Record<string, unknown> = { message: 'provider secret' };
  cyclic.self = cyclic;
  const capture = captureProviderDiagnostics({
    agent: { id: 'codex', version: '1.0.0' },
    caseId: 'bounded',
    phase: 'result',
    publicResult: { result: { text: 'ordinary assistant content' }, status: 'succeeded' },
    secrets: ['secret'],
    trace: {
      outbound: [
        {
          id: 7,
          method: 'session/update',
          params: {
            update: {
              error: { code: -32000, data: cyclic, message: 'secret provider failure' },
              status: 'failed',
            },
          },
        },
        { id: 8, result: { stopReason: 'end_turn' } },
        { id: 9, result: { text: 'ordinary provider text' } },
      ],
    },
  });

  expect(capture.observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'acp.update',
        id: 7,
        method: 'session/update',
        code: -32000,
      }),
      expect.objectContaining({ source: 'acp.result', id: 8, stopReason: 'end_turn' }),
    ]),
  );
  expect(capture.publicResult).toEqual({
    status: 'succeeded',
    unexpectedResponsePreview: 'ordinary assistant content',
  });
  expect(JSON.stringify(capture)).not.toContain('secret');
  expect(capture.truncation.truncated).toBe(true);
});

test('handles undefined error data and records child exit metadata', () => {
  const capture = captureProviderDiagnostics({
    agent: { id: 'codex', version: '1.0.0' },
    caseId: 'undefined-data',
    phase: 'close',
    publicResult: {
      status: 'failed',
      error: { code: 'revo.agent.protocol_failed', message: 'generic' },
    },
    trace: {
      outbound: [{ id: 2, error: { code: -32603, message: 'provider failed' } }],
      exited: true,
      exitCode: 143,
      exitSignal: null,
    },
  });

  expect(capture.observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: 'acp.error', code: -32603, data: undefined }),
      expect.objectContaining({ source: 'exit', data: { exited: true, code: 143, signal: null } }),
      expect.objectContaining({ source: 'runtime.fault' }),
    ]),
  );
});

test('redacts bounded protocol metadata and previews completed session messages', () => {
  const capture = captureProviderDiagnostics({
    agent: { id: 'codex', version: '1.0.0' },
    caseId: 'metadata',
    phase: 'result',
    secrets: ['secret'],
    publicResult: {
      message: { content: 'API Error: secret provider unavailable' },
      status: 'completed',
    },
    trace: {
      outbound: [
        {
          error: { code: 'secret-code', message: 'secret failure' },
          id: 'secret-id',
          method: 'secret-method',
          result: { stopReason: 'secret-stop' },
        },
      ],
    },
  });

  expect(capture.publicResult).toEqual({
    unexpectedResponsePreview: 'API Error: [REDACTED] provider unavailable',
    status: 'completed',
  });
  expect(JSON.stringify(capture)).not.toContain('secret');
  expect(capture.truncation.truncated).toBe(false);
});

test('keeps multibyte stderr evidence within the byte cap', () => {
  const capture = captureProviderDiagnostics({
    agent: { id: 'codex', version: '1.0.0' },
    caseId: 'utf8-stderr',
    phase: 'close',
    publicResult: { status: 'completed' },
    trace: { stderr: ['🙂'.repeat(3000)] },
  });
  const stderr = capture.observations.find((observation) => observation.source === 'stderr');
  expect(stderr?.message).toBeDefined();
  expect(new TextEncoder().encode(stderr?.message).byteLength).toBeLessThanOrEqual(2048);
  expect(capture.truncation.truncated).toBe(true);
});
