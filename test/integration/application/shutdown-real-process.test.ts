import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import {
  createNodePosixInvocationOutputPort,
  NodePosixOutputClaimPort,
  NodePosixOutputPreparationPort,
} from '../../../src/platform/process/index.js';
import type {
  ActiveInvocationSnapshot,
  ActiveStateOperationContext,
} from '../../../src/runtime/spec/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FreshAvailableExecutableProbePort } from '../../support/probe/fresh-available-executable-probe-port.js';

let temporaryRoot: string | undefined;

const waitUntil = async (predicate: () => Promise<boolean>, remaining = 100): Promise<void> => {
  if (await predicate()) return;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    await waitUntil(predicate, remaining - 1);
    return;
  }
  expect(await predicate()).toBe(true);
};

const readIfExists = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

afterEach(async () => {
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

test.runIf(process.platform === 'linux')(
  'shutdown terminates and reaps a real process before resolving',
  async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'revo-shutdown-real-'));
    const outputParent = join(temporaryRoot, 'outputs');
    await mkdir(outputParent);
    const outputDirectory = join(outputParent, 'invocation');
    const pidFile = join(temporaryRoot, 'child.pid');
    const signalFile = join(temporaryRoot, 'signals.log');
    const script = `
const fs = require('node:fs');
const [pidFile, signalFile] = process.argv.slice(1, 3);
fs.writeFileSync(pidFile, String(process.pid));
process.on('SIGTERM', () => {
  fs.appendFileSync(signalFile, 'SIGTERM\\n');
});
setInterval(() => undefined, 1000);
`;
    const definition = buildAgentDefinition({
      launch: {
        command: process.execPath,
        args: [
          { kind: 'literal', value: '-e' },
          { kind: 'literal', value: script },
          { kind: 'literal', value: pidFile },
          { kind: 'literal', value: signalFile },
          { kind: 'prompt' },
          { kind: 'result-schema' },
        ],
        versionProbe: {
          args: ['-e', "console.log('agent 1.0.0')"],
          stream: 'stdout',
          prefix: 'agent ',
          timeoutMs: 1_000,
        },
      },
    });
    const activeStateEvents: string[] = [];
    let processExistedDuringRemove: boolean | undefined;
    const manager = createInvocationLifecycleManager(
      {
        activeStateSink: Object.freeze({
          save: async (
            snapshot: ActiveInvocationSnapshot,
            _context: ActiveStateOperationContext,
          ): Promise<void> => {
            activeStateEvents.push(`save:${snapshot.state}`);
            expect(processExists(snapshot.process.pid)).toBe(true);
          },
          remove: async (
            invocationId: string,
            _context: ActiveStateOperationContext,
          ): Promise<void> => {
            activeStateEvents.push(`remove:${invocationId}`);
            const pidText = await readIfExists(pidFile);
            processExistedDuringRemove =
              pidText === undefined ? undefined : processExists(Number(pidText));
          },
        }),
        definitions: [definition],
      },
      () => ({
        clock: new FakeInvocationClock({ initialNowMs: 0 }),
        executableProbe: new FreshAvailableExecutableProbePort(process.execPath, '1.0.0'),
        output: createNodePosixInvocationOutputPort(),
        outputClaim: new NodePosixOutputClaimPort(),
        outputPreparation: new NodePosixOutputPreparationPort(),
        workspace: { admit: async (directory) => ({ status: 'admitted', directory }) },
      }),
    );
    await manager.initialize([]);

    const start = await manager.start({
      invocationId: 'real-shutdown',
      agent: { id: definition.id, version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: temporaryRoot },
      parameters: {},
      permissions: {},
      result: {
        schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
      },
      output: { directory: outputDirectory },
    });
    expect(start.status).toBe('accepted');
    if (start.status !== 'accepted') throw new Error('Expected accepted invocation.');
    activeStateEvents.push('accepted');
    expect(activeStateEvents).toEqual(['save:running', 'accepted']);
    await waitUntil(async () => (await readIfExists(pidFile)) !== undefined);
    const pidText = await readFile(pidFile, 'utf8');
    const pid = Number(pidText);
    expect(Number.isSafeInteger(pid)).toBe(true);
    expect(processExists(pid)).toBe(true);

    const startedAt = Date.now();
    await expect(manager.shutdown('integration shutdown')).resolves.toBeUndefined();
    const elapsedMs = Date.now() - startedAt;

    await expect(start.handle.result()).resolves.toMatchObject({ status: 'cancelled' });
    activeStateEvents.push('result');
    await expect(readFile(signalFile, 'utf8')).resolves.toContain('SIGTERM');
    expect(processExists(pid)).toBe(false);
    expect(processExistedDuringRemove).toBe(false);
    expect(activeStateEvents).toEqual([
      'save:running',
      'accepted',
      'save:cancelling',
      'remove:real-shutdown',
      'result',
    ]);
    expect(elapsedMs).toBeGreaterThanOrEqual(1_900);
  },
);
