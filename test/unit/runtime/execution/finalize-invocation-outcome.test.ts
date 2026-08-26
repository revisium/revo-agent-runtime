import { expect, test } from 'vitest';

import {
  BoundedRawResponseEvidence,
  finalizeInvocationOutcome,
  RawFinalResponseEligibility,
  type NormalizedInvocationOutcome,
  type RawResponsePublicationResult,
  type ScratchCleanupResult,
  type TerminalPublicationPort,
  type TerminalResultPublicationResult,
} from '../../../../src/runtime/execution/index.js';
import { TerminalPublicationAuthority } from '../../../../src/runtime/execution/output-preparation-attempt/index.js';
import type {
  AgentInvocationResult,
  AgentInvocationResultBase,
} from '../../../../src/runtime/spec/index.js';

const invocationToken = Object.freeze({});
const authority = TerminalPublicationAuthority.create({
  invocationId: 'invocation-1',
  outputDirectory: '/outputs/invocation-1',
  invocationToken,
});

const base = Object.freeze({
  schemaVersion: 'agent-invocation-result/v1' as const,
  invocationId: 'invocation-1',
  pin: Object.freeze({ agentId: 'codex', agentVersion: '1.0.0', definitionDigest: 'sha256:abc' }),
  launch: Object.freeze({ executable: '/usr/bin/codex', reportedVersion: '1.2.3' }),
  acceptedAt: '2026-08-22T00:00:00.000Z',
  files: Object.freeze({
    directory: '/outputs/invocation-1',
    events: 'events.ndjson' as const,
    stdout: 'stdout.log' as const,
    stderr: 'stderr.log' as const,
  }),
}) satisfies Omit<AgentInvocationResultBase, 'finishedAt' | 'durationMs' | 'exit' | 'files'> & {
  readonly files: AgentInvocationResultBase['files'];
};

const rawEvidence = (bytes: Uint8Array) =>
  BoundedRawResponseEvidence.create({ byteLength: bytes.byteLength, bytes, previewBytes: 64 });

const parserFailure = (
  input: {
    reason?: 'invalid_json' | 'frame_malformed' | 'missing_terminal';
    rawResponse?: BoundedRawResponseEvidence;
    exit?: Readonly<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  } = {},
): NormalizedInvocationOutcome =>
  Object.freeze({
    status: 'failed',
    failure: Object.freeze({
      kind: 'parser' as const,
      reason: input.reason ?? 'invalid_json',
      code: 'revo.agent.result_invalid_json' as const,
    }),
    evidence: Object.freeze({
      ...(input.exit === undefined ? {} : { exit: input.exit }),
      ...(input.rawResponse === undefined ? {} : { rawResponse: input.rawResponse }),
    }),
  });

const success = Object.freeze({
  status: 'succeeded' as const,
  value: Object.freeze({ ok: true }),
  evidence: Object.freeze({ exit: Object.freeze({ exitCode: 0, signal: null }) }),
});

class FakeTerminalPublicationPort implements TerminalPublicationPort {
  cleanupResult: ScratchCleanupResult = Object.freeze({ status: 'absent' });
  rawResult: RawResponsePublicationResult = Object.freeze({
    status: 'published',
    file: 'raw-final-response.txt',
  });
  terminalResult: TerminalResultPublicationResult = Object.freeze({
    status: 'published',
    file: 'result.json',
  });
  terminalReject = false;
  readonly rawPublications: Uint8Array[] = [];
  readonly terminalPublications: AgentInvocationResult[] = [];

  async appendLifecycleEvent(): Promise<never> {
    throw new Error('appendLifecycleEvent is not part of finalizeInvocationOutcome');
  }

  async cleanupScratch(): Promise<ScratchCleanupResult> {
    return this.cleanupResult;
  }

  async publishRawResponse(
    _authority: TerminalPublicationAuthority,
    _eligibility: RawFinalResponseEligibility,
    bytes: Uint8Array,
  ): Promise<RawResponsePublicationResult> {
    this.rawPublications.push(new Uint8Array(bytes));
    return this.rawResult;
  }

  async publishTerminalResult(
    _authority: TerminalPublicationAuthority,
    result: AgentInvocationResult,
  ): Promise<TerminalResultPublicationResult> {
    this.terminalPublications.push(result);
    if (this.terminalReject) throw new Error('terminal publication rejected');
    return this.terminalResult;
  }
}

test('converts a rejecting terminal publication into an output-write failure with exit evidence', async () => {
  const output = new FakeTerminalPublicationPort();
  output.terminalReject = true;

  const result = await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => false,
    invocationToken,
    base,
    normalized: parserFailure({
      exit: Object.freeze({ exitCode: 7, signal: 'SIGTERM' }),
    }),
  });

  expect(result).toMatchObject({
    status: 'failed',
    error: { code: 'revo.agent.output_write_failed' },
    exit: { code: 7, signal: 'SIGTERM' },
  });
  expect(result.files.result).toBeUndefined();
});

test('optimistically commits result.json for a successfully published failed result', async () => {
  const output = new FakeTerminalPublicationPort();
  const result = await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => false,
    invocationToken,
    base,
    normalized: parserFailure(),
  });

  expect(result.status).toBe('failed');
  expect(result.files.result).toBe('result.json');
});

test('rebuilds delivered result after late result publication failure without retrying', async () => {
  const output = new FakeTerminalPublicationPort();
  output.terminalResult = Object.freeze({ status: 'write_failed' });

  const result = await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => false,
    invocationToken,
    base,
    normalized: success,
  });

  expect(output.terminalPublications).toHaveLength(1);
  expect(result).toMatchObject({
    status: 'failed',
    error: { code: 'revo.agent.output_write_failed' },
  });
  expect(result).toMatchObject({
    status: 'failed',
    files: { directory: '/outputs/invocation-1' },
  });
  expect(result.files.result).toBeUndefined();
});

test('treats an undefined invocation token as raw-response ineligible', async () => {
  const output = new FakeTerminalPublicationPort();
  const rawResponse = rawEvidence(new TextEncoder().encode('{'));

  await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => false,
    invocationToken: undefined,
    base,
    normalized: parserFailure({ rawResponse }),
  });

  expect(output.rawPublications).toEqual([]);
  expect(BoundedRawResponseEvidence.take(rawResponse)).toBeUndefined();
});

test('keeps scratch cleanup failure precedence over raw publication failure', async () => {
  const output = new FakeTerminalPublicationPort();
  output.cleanupResult = Object.freeze({ status: 'failed', reason: 'cleanup_failed' });
  output.rawResult = Object.freeze({ status: 'write_failed' });

  const result = await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => false,
    invocationToken,
    base,
    normalized: parserFailure({ rawResponse: rawEvidence(new TextEncoder().encode('{')) }),
  });

  expect(output.rawPublications).toHaveLength(1);
  expect(result).toMatchObject({
    status: 'failed',
    error: { code: 'revo.agent.scratch_cleanup_failed' },
  });
});

test('downgrades when pending nonterminal evidence failed', async () => {
  const output = new FakeTerminalPublicationPort();
  const result = await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => true,
    invocationToken,
    base,
    normalized: success,
  });

  expect(result).toMatchObject({
    status: 'failed',
    error: { code: 'revo.agent.output_write_failed' },
  });
});

test('does not downgrade for suppressed pending nonterminal evidence', async () => {
  const output = new FakeTerminalPublicationPort();
  const result = await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => false,
    invocationToken,
    base,
    normalized: success,
  });

  expect(result.status).toBe('succeeded');
});

test('keeps scratch cleanup precedence over pending nonterminal evidence failure', async () => {
  const output = new FakeTerminalPublicationPort();
  output.cleanupResult = Object.freeze({ status: 'failed', reason: 'cleanup_failed' });
  const result = await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => true,
    invocationToken,
    base,
    normalized: success,
  });

  expect(result).toMatchObject({
    status: 'failed',
    error: { code: 'revo.agent.scratch_cleanup_failed' },
  });
});

test('mints raw-response eligibility from the original outcome before scratch downgrade', async () => {
  const output = new FakeTerminalPublicationPort();
  output.cleanupResult = Object.freeze({ status: 'failed', reason: 'cleanup_failed' });

  const bytes = new TextEncoder().encode('{');
  await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => false,
    invocationToken,
    base,
    normalized: parserFailure({ rawResponse: rawEvidence(bytes) }),
  });

  expect(output.rawPublications).toEqual([bytes]);
});

test('takes raw-response evidence exactly once even when publication is ineligible', async () => {
  const output = new FakeTerminalPublicationPort();
  const rawResponse = rawEvidence(new TextEncoder().encode('bad frame'));

  await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => false,
    invocationToken,
    base,
    normalized: parserFailure({ reason: 'frame_malformed', rawResponse }),
  });

  expect(output.rawPublications).toEqual([]);
  expect(BoundedRawResponseEvidence.take(rawResponse)).toBeUndefined();
});

test('maps terminal result exit fields from normalized evidence', async () => {
  const output = new FakeTerminalPublicationPort();

  await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => false,
    invocationToken,
    base,
    normalized: success,
  });
  await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => false,
    invocationToken,
    base,
    normalized: parserFailure({ exit: Object.freeze({ exitCode: 7, signal: 'SIGTERM' }) }),
  });

  expect(output.terminalPublications[0]?.exit).toEqual({ code: 0, signal: null });
  expect(output.terminalPublications[1]?.exit).toEqual({ code: 7, signal: 'SIGTERM' });
});

test('tags raw response file symmetrically only after successful raw publication', async () => {
  const output = new FakeTerminalPublicationPort();

  const result = await finalizeInvocationOutcome({
    output,
    authority,
    flushPendingEvidence: async () => false,
    invocationToken,
    base,
    normalized: parserFailure({ rawResponse: rawEvidence(new TextEncoder().encode('{')) }),
  });

  expect(result).toMatchObject({
    status: 'failed',
    rawResponse: { file: 'raw-final-response.txt' },
    files: { rawFinalResponse: 'raw-final-response.txt' },
  });
});
