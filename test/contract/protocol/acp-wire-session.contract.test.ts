import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { createAgentManager } from '../../../src/index.js';
import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import { invocationOutputDirectory } from '../../support/builders/public-agent-manager.js';
import { fakeAcpDefinition } from '../../support/fakes/fake-acp.js';
import { noOpActiveStateSink } from '../../support/stories/active-state.js';

type AcpFrame = Readonly<Record<string, unknown>>;

interface AcpWireGolden {
  readonly schemaVersion: 'acp-wire/v1';
  readonly inbound: readonly AcpFrame[];
  readonly outbound: readonly AcpFrame[];
  readonly promptSha256: string;
  readonly resultChunkSha256: string;
}

interface AcpWireTrace {
  readonly closeReceived: boolean;
  readonly exited: boolean;
  readonly inbound: readonly AcpFrame[];
  readonly outbound: readonly AcpFrame[];
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isFrames = (value: unknown): value is readonly AcpFrame[] =>
  Array.isArray(value) && value.every(isRecord);

const readGolden = async (): Promise<{ readonly raw: string; readonly value: AcpWireGolden }> => {
  const raw = await readFile(new URL('../fixtures/acp-v1.golden.json', import.meta.url), 'utf8');
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    value.schemaVersion !== 'acp-wire/v1' ||
    !isFrames(value.inbound) ||
    !isFrames(value.outbound) ||
    typeof value.promptSha256 !== 'string' ||
    typeof value.resultChunkSha256 !== 'string'
  )
    throw new TypeError('Invalid ACP wire golden artifact.');
  return {
    raw,
    value: {
      inbound: value.inbound,
      outbound: value.outbound,
      promptSha256: value.promptSha256,
      resultChunkSha256: value.resultChunkSha256,
      schemaVersion: value.schemaVersion,
    },
  };
};

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

const textAt = (frame: AcpFrame, path: readonly string[]): string => {
  let value: unknown = frame;
  for (const key of path) {
    if (!isRecord(value) || !(key in value)) throw new TypeError(`Missing ${path.join('.')}.`);
    value = value[key];
  }
  if (typeof value !== 'string') throw new TypeError(`Expected text at ${path.join('.')}.`);
  return value;
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

const withStableWorkspace = (trace: AcpWireTrace): AcpWireTrace => {
  const stable = structuredClone(trace);
  const sessionNew = stable.inbound[1];
  if (!isRecord(sessionNew) || !isRecord(sessionNew.params))
    throw new TypeError('Expected session/new frame.');
  sessionNew.params.cwd = '/workspace';
  return stable;
};
test('replays the committed ACP NDJSON vector through the official SDK', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'acp.ndjson.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ traceFile })],
    });
    await manager.initialize([]);

    const result = await (await manager.start(request(directory))).result();
    const [golden, expectedArtifactSha256, trace] = await Promise.all([
      readGolden(),
      readFile(new URL('../fixtures/acp-v1.golden.sha256', import.meta.url), 'utf8'),
      readTrace(traceFile),
    ]);

    await manager.shutdown();

    expect(sha256(golden.raw)).toBe(expectedArtifactSha256.trim());
    expect(trace).toMatchObject({ closeReceived: true, exited: true });
    expect(withStableWorkspace(trace).inbound).toEqual(golden.value.inbound);
    expect(trace.outbound).toEqual(golden.value.outbound);
    expect(sha256(textAt(trace.inbound[2]!, ['params', 'prompt', '0', 'text']))).toBe(
      golden.value.promptSha256,
    );
    expect(sha256(textAt(trace.outbound[2]!, ['params', 'update', 'content', 'text']))).toBe(
      golden.value.resultChunkSha256,
    );
    expect(result).toMatchObject({ status: 'succeeded', value: { answer: 'fake ACP result' } });
  });
});

test('accepts an SDK-unknown ACP notification without changing the terminal result', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'unknown' })],
    });
    await manager.initialize([]);

    const result = await (await manager.start(request(directory))).result();

    await manager.shutdown();
    expect(result).toMatchObject({ status: 'succeeded', value: { answer: 'fake ACP result' } });
  });
});

test('answers ACP permission requests with an explicit rejection selection', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'permission.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'permission-request', traceFile })],
    });
    await manager.initialize([]);

    const result = await (await manager.start(request(directory))).result();
    const trace = await readTrace(traceFile);
    await manager.shutdown();

    const permissionRequest = trace.outbound.find(
      (frame) => frame.method === 'session/request_permission',
    );
    if (permissionRequest === undefined) throw new TypeError('Missing ACP permission request.');
    const permissionResponse = trace.inbound.find(
      (frame) => frame.id === permissionRequest.id && 'result' in frame,
    );

    expect(permissionResponse).toMatchObject({
      result: { outcome: { optionId: 'reject-fixture', outcome: 'selected' } },
    });
    expect(result).toMatchObject({ status: 'succeeded', value: { answer: 'fake ACP result' } });
  });
});

test('cancels an ACP permission request when no rejection option is available', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'permission-denied.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'permission-without-rejection', traceFile })],
    });
    await manager.initialize([]);

    await (await manager.start(request(directory))).result();
    const trace = await readTrace(traceFile);
    await manager.shutdown();

    const permissionResponse = trace.inbound.find(
      (frame) => isRecord(frame.result) && 'outcome' in frame.result,
    );
    expect(permissionResponse).toMatchObject({ result: { outcome: { outcome: 'cancelled' } } });
  });
});
