import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { createAgentManager, type AgentInvocationResult } from '../../../src/index.js';
import { waitForFile } from '../../support/assertions/file-observation.js';
import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import { invocationOutputDirectory } from '../../support/builders/public-agent-manager.js';
import { fakeAcpDefinition } from '../../support/fakes/fake-acp.js';
import { noOpActiveStateSink } from '../../support/stories/active-state.js';

const invocationRequest = (directory: string, invocationId: string) => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId,
  output: { directory: invocationOutputDirectory(directory, invocationId) },
  parameters: {},
  permissions: {},
  prompt: 'Wait for supervision.',
  result: { schema: { type: 'object' } },
  workspace: { directory: process.cwd() },
});

const managerFor = (
  mode: string,
  options: { readonly idleTimeoutMs?: number; readonly traceFile?: string } = {},
) =>
  createAgentManager({
    activeStateSink: noOpActiveStateSink,
    definitions: [
      fakeAcpDefinition({
        mode,
        ...(options.traceFile === undefined ? {} : { traceFile: options.traceFile }),
      }),
    ],
    limits: {
      idleTimeoutMs: options.idleTimeoutMs ?? 1_000,
      wallClockTimeoutMs: 2_000,
    },
  });

const expectTerminalFault = (
  result: AgentInvocationResult,
  status: 'cancelled' | 'timed_out',
  code: 'revo.agent.cancelled' | 'revo.agent.timeout',
) => {
  expect(result).toMatchObject({ error: { code, phase: 'running' }, status });
};

test('caller cancellation is idempotent and finishes only after provider cancel and local reap', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'cancel.trace.json');
    const readyFile = join(directory, 'cancel.ready');
    const events: string[] = [];
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'hang', readyFile, traceFile })],
    });
    await manager.initialize([]);
    manager.subscribe({}, ({ type }) => events.push(type));
    const handle = await manager.start(invocationRequest(directory, 'cancelled-agent'));
    await waitForFile(readyFile);

    expect(await handle.cancel('caller stopped waiting')).toEqual({ state: 'requested' });
    expect(await manager.cancel(handle.invocationId, 'same request')).toEqual({
      state: 'requested',
    });
    const result = await handle.result();

    expectTerminalFault(result, 'cancelled', 'revo.agent.cancelled');
    expect(JSON.parse(await readFile(traceFile, 'utf8'))).toMatchObject({
      cancelReceived: true,
      exited: true,
    });
    expect(events).toEqual([
      'invocation.accepted',
      'invocation.started',
      'invocation.cancelling',
      'invocation.finished',
    ]);
    expect(await handle.cancel()).toMatchObject({ state: 'already_completed', result });
    await manager.shutdown();
    expect(await manager.cancel(handle.invocationId)).toMatchObject({
      state: 'already_completed',
      result,
    });
  });
});

test.each(['raw-activity', 'unknown-activity'])(
  '%s ACP traffic does not keep an idle invocation alive',
  async (mode) => {
    await withTemporaryDirectory(async (directory) => {
      const unknownActivityManager = managerFor(mode, { idleTimeoutMs: 1_000 });
      await unknownActivityManager.initialize([]);
      const idleResult = await (
        await unknownActivityManager.start(invocationRequest(directory, 'unknown-activity'))
      ).result();
      await unknownActivityManager.shutdown();

      expectTerminalFault(idleResult, 'timed_out', 'revo.agent.timeout');
    });
  },
);

test('shutdown shares one drain and cancels every accepted invocation', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = managerFor('hang');
    await manager.initialize([]);
    const handle = await manager.start(invocationRequest(directory, 'shutdown-agent'));

    const firstShutdown = manager.shutdown('runtime stopped');
    expect(manager.shutdown('ignored later reason')).toBe(firstShutdown);
    expect(await manager.cancel(handle.invocationId)).toEqual({ state: 'requested' });
    await firstShutdown;

    expectTerminalFault(await handle.result(), 'cancelled', 'revo.agent.cancelled');
  });
});
