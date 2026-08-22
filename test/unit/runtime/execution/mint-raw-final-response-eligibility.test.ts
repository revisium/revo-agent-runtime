import { expect, test } from 'vitest';

import { mintRawFinalResponseEligibility } from '../../../../src/runtime/execution/mint-raw-final-response-eligibility.js';
import type { NormalizedInvocationOutcome } from '../../../../src/runtime/execution/normalized-invocation-outcome.js';
import { RawFinalResponseEligibility } from '../../../../src/runtime/execution/raw-final-response-eligibility.js';
import type { ParserFailureReason } from '../../../../src/runtime/execution/result-parser/index.js';

const token: object = Object.freeze({});

const succeeded = (): NormalizedInvocationOutcome =>
  Object.freeze({ status: 'succeeded', value: Object.freeze({}), evidence: Object.freeze({}) });

const cancelled = (): NormalizedInvocationOutcome =>
  Object.freeze({ status: 'cancelled', evidence: Object.freeze({}) });

const timedOut = (): NormalizedInvocationOutcome =>
  Object.freeze({ status: 'timed_out', evidence: Object.freeze({}) });

const parserFailure = (reason: ParserFailureReason): NormalizedInvocationOutcome =>
  Object.freeze({
    status: 'failed',
    failure: Object.freeze({ kind: 'parser', reason, code: 'revo.agent.result_missing' }),
    evidence: Object.freeze({}),
  });

const resultSchemaFailure = (): NormalizedInvocationOutcome =>
  Object.freeze({
    status: 'failed',
    failure: Object.freeze({ kind: 'result_schema', code: 'revo.agent.result_schema_mismatch' }),
    evidence: Object.freeze({}),
  });

const duplexFailure = (): NormalizedInvocationOutcome =>
  Object.freeze({
    status: 'failed',
    failure: Object.freeze({
      kind: 'duplex',
      primary: Object.freeze({ kind: 'process_failed' }),
      code: 'revo.agent.process_failed',
    }),
    evidence: Object.freeze({}),
  });

const finalizationFailure = (): NormalizedInvocationOutcome =>
  Object.freeze({
    status: 'failed',
    failure: Object.freeze({ kind: 'finalization', code: 'revo.agent.output_write_failed' }),
    evidence: Object.freeze({}),
  });

test.each<NormalizedInvocationOutcome>([succeeded(), cancelled(), timedOut()])(
  'returns undefined for non-failed outcomes',
  (outcome) => {
    expect(mintRawFinalResponseEligibility(outcome, token)).toBeUndefined();
  },
);

test.each<[ParserFailureReason, 'result_extraction' | 'result_parsing']>([
  ['response_empty', 'result_extraction'],
  ['response_too_large', 'result_extraction'],
  ['duplicate_terminal', 'result_extraction'],
  ['missing_terminal', 'result_extraction'],
  ['invalid_utf8', 'result_parsing'],
  ['invalid_json', 'result_parsing'],
  ['response_not_object', 'result_parsing'],
])('mints eligibility bound to the invocation token for parser reason %s', (reason, partition) => {
  const eligibility = mintRawFinalResponseEligibility(parserFailure(reason), token);
  expect(eligibility).toBeInstanceOf(RawFinalResponseEligibility);
  expect(eligibility?.partition).toBe(partition);
  expect(eligibility?.reason).toBe(reason);
  expect(RawFinalResponseEligibility.isBoundToToken(eligibility, token)).toBe(true);
  expect(RawFinalResponseEligibility.isBoundToToken(eligibility, Object.freeze({}))).toBe(false);
});

test.each<ParserFailureReason>(['frame_malformed', 'frame_overflow'])(
  'does not mint eligibility for non-publishable parser reason %s',
  (reason) => {
    expect(mintRawFinalResponseEligibility(parserFailure(reason), token)).toBeUndefined();
  },
);

test('mints eligibility for a result-schema failure', () => {
  const eligibility = mintRawFinalResponseEligibility(resultSchemaFailure(), token);
  expect(eligibility).toBeInstanceOf(RawFinalResponseEligibility);
  expect(eligibility?.partition).toBe('result_schema');
  expect(eligibility?.reason).toBe('result_schema_failed');
  expect(RawFinalResponseEligibility.isBoundToToken(eligibility, token)).toBe(true);
});

test('never mints eligibility for a duplex failure', () => {
  expect(mintRawFinalResponseEligibility(duplexFailure(), token)).toBeUndefined();
});

test('never mints eligibility for a finalization failure', () => {
  expect(mintRawFinalResponseEligibility(finalizationFailure(), token)).toBeUndefined();
});
