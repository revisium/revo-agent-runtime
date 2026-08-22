import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';
import { RawFinalResponseEligibility } from './raw-final-response-eligibility.js';
import type { RawFinalResponsePartition } from './raw-final-response-partition.js';
import type { RawFinalResponseReason } from './raw-final-response-reason.js';

const partitionFor = (reason: RawFinalResponseReason): RawFinalResponsePartition => {
  switch (reason) {
    case 'response_empty':
    case 'response_too_large':
    case 'duplicate_terminal':
    case 'missing_terminal':
      return 'result_extraction' as const;
    case 'invalid_utf8':
    case 'invalid_json':
    case 'response_not_object':
      return 'result_parsing' as const;
    case 'result_schema_failed':
      return 'result_schema' as const;
  }
  throw new Error('Unhandled raw final response reason.');
};

export const mintRawFinalResponseEligibility = (
  outcome: NormalizedInvocationOutcome,
  invocationToken: object,
): RawFinalResponseEligibility | undefined => {
  if (outcome.status !== 'failed') return undefined;
  if (outcome.failure.kind === 'parser') {
    switch (outcome.failure.reason) {
      case 'response_empty':
      case 'response_too_large':
      case 'duplicate_terminal':
      case 'missing_terminal':
      case 'invalid_utf8':
      case 'invalid_json':
      case 'response_not_object':
        return RawFinalResponseEligibility.create({
          invocationToken,
          partition: partitionFor(outcome.failure.reason),
          reason: outcome.failure.reason,
        });
      case 'frame_malformed':
      case 'frame_overflow':
        return undefined;
    }
  }
  if (outcome.failure.kind === 'result_schema') {
    return RawFinalResponseEligibility.create({
      invocationToken,
      partition: 'result_schema',
      reason: 'result_schema_failed',
    });
  }
  return undefined;
};
