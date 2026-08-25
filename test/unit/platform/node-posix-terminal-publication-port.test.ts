import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { NodePosixTerminalPublicationPort } from '../../../src/platform/process/index.js';
import {
  beginOutputClaim,
  beginOutputPreparation,
  createOutputClaimAttempt,
  createOutputPreparationAttempt,
  getTerminalPublicationEventsCapability,
  RawFinalResponseEligibility,
  type EventsAppendSink,
  type OutputClaimExclusiveCreatePort,
  type OutputPreparationMutationRequest,
  type OutputPreparationPlatformResult,
} from '../../../src/runtime/execution/index.js';
import { ConsumedOutputPreparationMaterial } from '../../../src/runtime/execution/output-preparation-attempt/consumed-output-preparation-material.js';
import { ConsumedRedactionMaterial } from '../../../src/runtime/execution/output-preparation-attempt/consumed-redaction-material.js';
import { TerminalPublicationAuthority } from '../../../src/runtime/execution/output-preparation-attempt/terminal-publication-authority.js';
import { RegisteredSecrets } from '../../../src/runtime/execution/secret-registration/registered-secrets.js';
import type { AgentEvent, AgentInvocationSucceeded } from '../../../src/runtime/spec/index.js';

const fsSpies = vi.hoisted(() => ({
  link: vi.fn(),
  open: vi.fn(),
  rm: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  fsSpies.open.mockImplementation(actual.open);
  fsSpies.link.mockImplementation(actual.link);
  fsSpies.unlink.mockImplementation(actual.unlink);
  fsSpies.rm.mockImplementation(actual.rm);
  return {
    ...actual,
    link: fsSpies.link,
    open: fsSpies.open,
    rm: fsSpies.rm,
    unlink: fsSpies.unlink,
  };
});

let temporaryRoot: string | undefined;
const encoder = new TextEncoder();
const clock = Object.freeze({ now: () => 0, schedule: () => () => undefined });

afterEach(async () => {
  vi.restoreAllMocks();
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

const makeDirectory = async (): Promise<string> => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'revo-terminal-publication-'));
  const outputDirectory = join(temporaryRoot, 'out');
  await mkdir(outputDirectory);
  return outputDirectory;
};

const redactionChannel = () =>
  Object.freeze({
    feed: (chunk: Uint8Array) => chunk,
    flush: () => new Uint8Array(),
    dispose: () => undefined,
  });
const outputSink = () =>
  Object.freeze({ write: async () => undefined, end: async () => undefined });
const fileEventsSink = (path: string): EventsAppendSink =>
  Object.freeze({
    write: async (chunk: Uint8Array) => writeFile(path, chunk, { flag: 'a' }),
    flush: async () => undefined,
  });

const makeAuthority = async (sink?: EventsAppendSink): Promise<TerminalPublicationAuthority> => {
  const outputDirectory = await makeDirectory();
  const claimPort: OutputClaimExclusiveCreatePort = Object.freeze({
    createExclusiveOutputDirectory: async () => Object.freeze({ status: 'created' as const }),
  });
  const claim = createOutputClaimAttempt({
    invocationId: 'invocation-1',
    outputDirectory,
    clock,
    port: claimPort,
  });
  beginOutputClaim(claim);
  const claimResult = await claim.settlement;
  if (claimResult.status !== 'claimed') throw new Error('Expected claimed output.');
  const preparationPort = Object.freeze({
    prepareClaimedOutput: async (
      _request: OutputPreparationMutationRequest,
    ): Promise<OutputPreparationPlatformResult> =>
      Object.freeze({
        status: 'prepared' as const,
        attestations: Object.freeze([]),
        frontEnds: Object.freeze({
          stdout: redactionChannel(),
          stderr: redactionChannel(),
          rawResponse: redactionChannel(),
        }),
        evidenceSinks: Object.freeze({ stdout: outputSink(), stderr: outputSink() }),
        eventsAppendSink: sink ?? fileEventsSink(join(outputDirectory, 'events.ndjson')),
      }),
  });
  const attempt = createOutputPreparationAttempt({
    session: claimResult.session,
    clock,
    port: preparationPort,
  });
  if (attempt === undefined) throw new Error('Expected preparation attempt.');
  beginOutputPreparation(
    attempt,
    ConsumedOutputPreparationMaterial.create({
      invocationId: 'invocation-1',
      outputDirectory,
      invocationToken: {},
      files: [],
    }),
    ConsumedRedactionMaterial.create({
      invocationId: 'invocation-1',
      invocationToken: {},
      redaction: RegisteredSecrets.create([]),
    }),
  );
  const preparation = await attempt.settlement;
  if (preparation.status !== 'prepared') throw new Error('Expected prepared output.');
  return preparation.authority;
};

const event = (value = 'ok'): AgentEvent =>
  Object.freeze({
    schemaVersion: 'agent-event/v1',
    type: 'invocation.started',
    invocationId: 'invocation-1',
    pin: Object.freeze({ agentId: 'codex', agentVersion: '1.0.0', definitionDigest: 'sha256:abc' }),
    sequence: 1,
    timestamp: `2026-08-22T00:00:00.${value === 'ok' ? '000' : '001'}Z`,
  });
const terminalEvent = (value = 'done'): AgentEvent =>
  Object.freeze({
    schemaVersion: 'agent-event/v1',
    type: 'invocation.finished',
    invocationId: 'invocation-1',
    pin: Object.freeze({ agentId: 'codex', agentVersion: '1.0.0', definitionDigest: 'sha256:abc' }),
    sequence: 2,
    timestamp: `2026-08-22T00:00:01.${value === 'done' ? '000' : '001'}Z`,
  });
const withSerializedBodyBytes = (base: AgentEvent, targetBytes: number): AgentEvent => {
  const overhead = encoder.encode(JSON.stringify({ ...base, invocationId: '' })).byteLength;
  return Object.freeze({ ...base, invocationId: 'x'.repeat(targetBytes - overhead) });
};
const result = (outputDirectory: string): AgentInvocationSucceeded =>
  Object.freeze({
    schemaVersion: 'agent-invocation-result/v1',
    invocationId: 'invocation-1',
    pin: Object.freeze({ agentId: 'codex', agentVersion: '1.0.0', definitionDigest: 'sha256:abc' }),
    launch: Object.freeze({ executable: '/usr/bin/codex', reportedVersion: '1.2.3' }),
    acceptedAt: '2026-08-22T00:00:00.000Z',
    finishedAt: '2026-08-22T00:00:01.000Z',
    durationMs: 1000,
    exit: Object.freeze({ code: 0, signal: null }),
    files: Object.freeze({
      directory: outputDirectory,
      events: 'events.ndjson',
      stdout: 'stdout.log',
      stderr: 'stderr.log',
      result: 'result.json',
    }),
    status: 'succeeded',
    value: Object.freeze({ ok: true }),
  });
const sha256 = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

test('returns no events capability for a foreign object', () => {
  expect(getTerminalPublicationEventsCapability(Object.freeze({}))).toBeUndefined();
});

test('appendLifecycleEvent writes one valid JSON line with one LF', async () => {
  const authority = await makeAuthority();
  await expect(
    new NodePosixTerminalPublicationPort().appendLifecycleEvent(authority, event()),
  ).resolves.toEqual({ status: 'appended' });
  const bytes = await readFile(join(authority.outputDirectory, 'events.ndjson'));
  expect(bytes.at(-1)).toBe(0x0a);
  expect(bytes.filter((byte) => byte === 0x0a)).toHaveLength(1);
  expect(JSON.parse(Buffer.from(bytes.subarray(0, -1)).toString('utf8'))).toMatchObject({
    type: 'invocation.started',
  });
});

test('appendLifecycleEvent accepts a nonterminal JSON body exactly at maxEventBytes', async () => {
  const authority = await makeAuthority();
  const port = new NodePosixTerminalPublicationPort({
    maxEventBytes: 256,
    maxEventsFileBytes: 2_097_667,
    maxTerminalEventBytes: 2_097_152,
  });
  await expect(
    port.appendLifecycleEvent(authority, withSerializedBodyBytes(event(), 256)),
  ).resolves.toEqual({ status: 'appended' });
  await expect(stat(join(authority.outputDirectory, 'events.ndjson'))).resolves.toMatchObject({
    size: 257,
  });
});

test('appendLifecycleEvent suppresses oversized and exhausted nonterminal lines without mutating the file', async () => {
  const authority = await makeAuthority();
  const port = new NodePosixTerminalPublicationPort({
    maxEventBytes: 256,
    maxEventsFileBytes: 2_097_667,
    maxTerminalEventBytes: 2_097_152,
  });
  await expect(
    port.appendLifecycleEvent(authority, withSerializedBodyBytes(event(), 257)),
  ).resolves.toEqual({ status: 'suppressed', reason: 'nonterminal_budget_exhausted' });
  await expect(
    port.appendLifecycleEvent(authority, withSerializedBodyBytes(event(), 256)),
  ).resolves.toEqual({ status: 'appended' });
  await expect(port.appendLifecycleEvent(authority, event('x'))).resolves.toEqual({
    status: 'suppressed',
    reason: 'nonterminal_budget_exhausted',
  });
  await expect(stat(join(authority.outputDirectory, 'events.ndjson'))).resolves.toMatchObject({
    size: 257,
  });
});

test('appendLifecycleEvent terminal path bypasses nonterminal budget but enforces terminal body cap', async () => {
  const authority = await makeAuthority();
  const port = new NodePosixTerminalPublicationPort({
    maxEventBytes: 256,
    maxEventsFileBytes: 2_097_667,
    maxTerminalEventBytes: 256,
  });
  await expect(
    port.appendLifecycleEvent(authority, withSerializedBodyBytes(event(), 256)),
  ).resolves.toEqual({ status: 'appended' });
  await expect(port.appendLifecycleEvent(authority, terminalEvent())).resolves.toEqual({
    status: 'appended',
  });
  await expect(
    port.appendLifecycleEvent(authority, withSerializedBodyBytes(terminalEvent(), 513)),
  ).resolves.toEqual({ status: 'failed', reason: 'write_failed' });
});

test('appendLifecycleEvent fails closed for an unauthenticated authority without touching a sink', async () => {
  const write = vi.fn<EventsAppendSink['write']>();
  const flush = vi.fn<EventsAppendSink['flush']>();
  await makeAuthority(Object.freeze({ write, flush }));
  const foreignAuthority = TerminalPublicationAuthority.create({
    invocationId: 'foreign',
    outputDirectory: '/tmp/foreign',
    invocationToken: {},
  });
  await expect(
    new NodePosixTerminalPublicationPort().appendLifecycleEvent(foreignAuthority, event()),
  ).resolves.toEqual({ status: 'failed', reason: 'write_failed' });
  expect(write).not.toHaveBeenCalled();
  expect(flush).not.toHaveBeenCalled();
});

test('publishTerminalResult writes result.json exactly once without replacing an existing result', async () => {
  const authority = await makeAuthority();
  const terminal = result(authority.outputDirectory);
  await expect(
    new NodePosixTerminalPublicationPort().publishTerminalResult(authority, terminal),
  ).resolves.toEqual({ status: 'published', file: 'result.json' });
  await expect(readFile(join(authority.outputDirectory, 'result.json'), 'utf8')).resolves.toBe(
    JSON.stringify(terminal),
  );
  await expect(readFile(join(authority.outputDirectory, 'result.json.tmp'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  const before = await sha256(join(authority.outputDirectory, 'result.json'));
  await expect(
    new NodePosixTerminalPublicationPort().publishTerminalResult(authority, terminal),
  ).resolves.toEqual({ status: 'conflict' });
  await expect(sha256(join(authority.outputDirectory, 'result.json'))).resolves.toBe(before);
});

test('publishTerminalResult maps an existing temporary file to conflict before writing', async () => {
  const authority = await makeAuthority();
  const terminal = result(authority.outputDirectory);
  await writeFile(join(authority.outputDirectory, 'result.json.tmp'), 'claimed');

  await expect(
    new NodePosixTerminalPublicationPort().publishTerminalResult(authority, terminal),
  ).resolves.toEqual({ status: 'conflict' });
  await expect(readFile(join(authority.outputDirectory, 'result.json.tmp'), 'utf8')).resolves.toBe(
    'claimed',
  );
});

test('publishRawResponse rejects eligibility minted for another invocation token', async () => {
  const authority = await makeAuthority();
  const foreignEligibility = RawFinalResponseEligibility.create({
    invocationToken: {},
    partition: 'result_parsing',
    reason: 'invalid_json',
  });

  await expect(
    new NodePosixTerminalPublicationPort().publishRawResponse(
      authority,
      foreignEligibility,
      encoder.encode('{bad}'),
    ),
  ).resolves.toEqual({ status: 'write_failed' });
  await expect(
    readFile(join(authority.outputDirectory, 'raw-final-response.txt')),
  ).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('publishTerminalResult fails closed for an unauthenticated authority without touching the filesystem', async () => {
  vi.clearAllMocks();
  const foreignAuthority = TerminalPublicationAuthority.create({
    invocationId: 'foreign',
    outputDirectory: '/tmp/foreign',
    invocationToken: {},
  });

  await expect(
    new NodePosixTerminalPublicationPort().publishTerminalResult(
      foreignAuthority,
      result(foreignAuthority.outputDirectory),
    ),
  ).resolves.toEqual({ status: 'write_failed' });
  expect(fsSpies.open).not.toHaveBeenCalled();
  expect(fsSpies.link).not.toHaveBeenCalled();
  expect(fsSpies.unlink).not.toHaveBeenCalled();
});

test('cleanupScratch removes only .scratch and leaves sibling evidence intact', async () => {
  const authority = await makeAuthority();
  await mkdir(join(authority.outputDirectory, '.scratch'));
  await writeFile(join(authority.outputDirectory, '.scratch', 'prompt.txt'), 'prompt');
  await writeFile(join(authority.outputDirectory, 'stdout.log'), 'stdout');
  await expect(new NodePosixTerminalPublicationPort().cleanupScratch(authority)).resolves.toEqual({
    status: 'cleaned',
  });
  await expect(new NodePosixTerminalPublicationPort().cleanupScratch(authority)).resolves.toEqual({
    status: 'absent',
  });
  await expect(readFile(join(authority.outputDirectory, 'stdout.log'), 'utf8')).resolves.toBe(
    'stdout',
  );
});

test('cleanupScratch fails closed for an unauthenticated authority without touching the filesystem', async () => {
  vi.clearAllMocks();
  const foreignAuthority = TerminalPublicationAuthority.create({
    invocationId: 'foreign',
    outputDirectory: '/tmp/foreign',
    invocationToken: {},
  });

  await expect(
    new NodePosixTerminalPublicationPort().cleanupScratch(foreignAuthority),
  ).resolves.toEqual({ status: 'failed', reason: 'cleanup_failed' });
  expect(fsSpies.rm).not.toHaveBeenCalled();
});
