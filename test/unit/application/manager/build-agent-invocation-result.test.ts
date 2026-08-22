import { expect, test } from 'vitest';

import { buildAgentInvocationResult } from '../../../../src/application/manager/build-agent-invocation-result.js';
import {
  RawFinalResponseEligibility,
  type NormalizedInvocationOutcome,
} from '../../../../src/runtime/execution/index.js';

const base = Object.freeze({
  schemaVersion: 'agent-invocation-result/v1' as const,
  invocationId: 'invocation-1',
  pin: Object.freeze({ agentId: 'agent', agentVersion: '1.0.0', definitionDigest: 'digest' }),
  launch: Object.freeze({ executable: '/bin/agent', reportedVersion: '1.0.0' }),
  acceptedAt: '2026-08-22T00:00:00.000Z',
  startedAt: '2026-08-22T00:00:00.100Z',
  finishedAt: '2026-08-22T00:00:01.000Z',
  durationMs: 900,
  exit: Object.freeze({ code: 0, signal: null }),
  files: Object.freeze({
    directory: '/outputs/invocation-1',
    events: 'events.ndjson',
    stdout: 'stdout.log',
    stderr: 'stderr.log',
    result: 'result.json',
  }),
});

test.each([
  [
    Object.freeze({
      status: 'succeeded',
      value: Object.freeze({ ok: true }),
      evidence: Object.freeze({}),
    }),
  ],
  [Object.freeze({ status: 'cancelled', evidence: Object.freeze({}) })],
  [Object.freeze({ status: 'timed_out', evidence: Object.freeze({}) })],
  [
    Object.freeze({
      status: 'failed',
      failure: Object.freeze({
        kind: 'parser',
        reason: 'invalid_json',
        code: 'revo.agent.result_invalid_json',
      }),
      evidence: Object.freeze({}),
    }),
  ],
] satisfies readonly (readonly [NormalizedInvocationOutcome])[])(
  'builds invocation result variant for %s outcome',
  (outcome) => {
    const result = buildAgentInvocationResult({ base, outcome });

    expect(result.status).toBe(outcome.status === 'timed_out' ? 'timed_out' : outcome.status);
    expect(result.invocationId).toBe(base.invocationId);
  },
);

const token = Object.freeze({});

test('cancelled and timed-out results publish running-phase faults', () => {
  const cancelled = buildAgentInvocationResult({
    base,
    outcome: Object.freeze({ status: 'cancelled', evidence: Object.freeze({}) }),
  });
  const timedOut = buildAgentInvocationResult({
    base,
    outcome: Object.freeze({ status: 'timed_out', evidence: Object.freeze({}) }),
  });

  expect(cancelled.status).toBe('cancelled');
  if (cancelled.status !== 'cancelled') throw new Error('expected cancelled');
  expect(cancelled.error).toMatchObject({ code: 'revo.agent.cancelled', phase: 'running' });
  expect(timedOut.status).toBe('timed_out');
  if (timedOut.status !== 'timed_out') throw new Error('expected timed out');
  expect(timedOut.error).toMatchObject({ code: 'revo.agent.timeout', phase: 'running' });
});

test('keeps raw-response eligibility invocation-bound', () => {
  const eligibility = RawFinalResponseEligibility.create({
    invocationToken: token,
    partition: 'result_parsing',
    reason: 'invalid_json',
  });

  expect(RawFinalResponseEligibility.isBoundToToken(eligibility, token)).toBe(true);
  expect(RawFinalResponseEligibility.isBoundToToken(eligibility, Object.freeze({}))).toBe(false);
});
