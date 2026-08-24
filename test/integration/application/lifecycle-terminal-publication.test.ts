import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import {
  createNodePosixInvocationOutputPort,
  NodePosixOutputClaimPort,
  NodePosixOutputPreparationPort,
} from '../../../src/platform/process/index.js';
import {
  BoundedRawResponseEvidence,
  type InvocationExecutionPorts,
} from '../../../src/runtime/execution/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FreshAvailableExecutableProbePort } from '../../support/probe/fresh-available-executable-probe-port.js';

let temporaryRoot: string | undefined;
const encoder = new TextEncoder();
const definition = buildAgentDefinition();
const agent = Object.freeze({ id: definition.id, version: definition.version });

const rawEvidence = (bytes: Uint8Array) =>
  BoundedRawResponseEvidence.create({ byteLength: bytes.byteLength, bytes, previewBytes: 64 });

const createExecution = (bytes: Uint8Array): InvocationExecutionPorts['execution'] =>
  Object.freeze({
    start: async (_snapshot, _preparedLaunch, resources) => {
      if (resources === undefined) throw new Error('Expected prepared resources.');
      await resources.evidenceSinks.stdout.end();
      await resources.evidenceSinks.stderr.end();
      resources.frontEnds.stdout.dispose();
      resources.frontEnds.stderr.dispose();
      return Object.freeze({
        spawnedAt: Date.now(),
        completion: Promise.resolve(
          Object.freeze({
            status: 'completed' as const,
            spawnedAt: Date.now(),
            exit: Object.freeze({ exitCode: 0, signal: null }),
            rawResponse: rawEvidence(bytes),
          }),
        ),
        requestCancellation: async () => undefined,
      });
    },
  });

const createStartInput = (invocationId: string, outputDirectory: string) =>
  Object.freeze({
    invocationId,
    agent,
    prompt: 'Return JSON.',
    workspace: Object.freeze({ directory: process.cwd() }),
    parameters: Object.freeze({}),
    permissions: Object.freeze({}),
    result: Object.freeze({
      schema: Object.freeze({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
      }),
    }),
    output: Object.freeze({ directory: outputDirectory }),
  });

const createManager = (execution: InvocationExecutionPorts['execution']) =>
  createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output: createNodePosixInvocationOutputPort(),
      outputClaim: new NodePosixOutputClaimPort(),
      outputPreparation: new NodePosixOutputPreparationPort(),
      executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
      workspace: {
        admit: async () => Object.freeze({ status: 'admitted' as const, directory: process.cwd() }),
      },
    },
  );

const createOutputDirectory = async (name: string): Promise<string> => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'revo-terminal-finalization-'));
  const parent = join(temporaryRoot, 'parent');
  await mkdir(parent);
  return join(parent, name);
};

const parseJsonFile = async (path: string): Promise<unknown> =>
  JSON.parse(new TextDecoder().decode(await readFile(path)));

afterEach(async () => {
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

test.runIf(process.platform === 'linux')(
  'publishes result.json for a completed invocation',
  async () => {
    const outputDirectory = await createOutputDirectory('success');
    const manager = createManager(createExecution(encoder.encode('{"ok":true}')));

    const accepted = await manager.start(createStartInput('published-success', outputDirectory));
    if (accepted.status !== 'accepted') throw new Error('Expected accepted invocation.');
    await expect(accepted.handle.result()).resolves.toMatchObject({ status: 'succeeded' });
    const snapshot = manager.getInvocation('published-success');
    expect(snapshot?.startedAt).toEqual(expect.any(String));
    expect(snapshot?.finishedAt).toEqual(expect.any(String));

    await expect(parseJsonFile(join(outputDirectory, 'result.json'))).resolves.toMatchObject({
      status: 'succeeded',
      value: { ok: true },
      files: { result: 'result.json' },
      startedAt: snapshot?.startedAt,
      finishedAt: snapshot?.finishedAt,
    });
  },
);

test.runIf(process.platform === 'linux')(
  'publishes eligible raw-final-response.txt bytes before result.json',
  async () => {
    const outputDirectory = await createOutputDirectory('invalid-json');
    const manager = createManager(createExecution(encoder.encode('{')));

    const accepted = await manager.start(createStartInput('published-raw', outputDirectory));
    if (accepted.status !== 'accepted') throw new Error('Expected accepted invocation.');
    await expect(accepted.handle.result()).resolves.toMatchObject({ status: 'failed' });

    expect(new Uint8Array(await readFile(join(outputDirectory, 'raw-final-response.txt')))).toEqual(
      encoder.encode('{'),
    );
    await expect(parseJsonFile(join(outputDirectory, 'result.json'))).resolves.toMatchObject({
      status: 'failed',
      rawResponse: { file: 'raw-final-response.txt' },
      files: { rawFinalResponse: 'raw-final-response.txt' },
    });
  },
);
