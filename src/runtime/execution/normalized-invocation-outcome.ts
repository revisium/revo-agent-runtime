import type { JsonObject } from '../spec/index.js';
import type { NormalizedInvocationEvidence } from './normalized-invocation-evidence.js';
import type { NormalizedInvocationFailure } from './normalized-invocation-failure.js';

export type NormalizedInvocationOutcome =
  | Readonly<{ status: 'succeeded'; value: JsonObject; evidence: NormalizedInvocationEvidence }>
  | Readonly<{
      status: 'failed';
      failure: NormalizedInvocationFailure;
      evidence: NormalizedInvocationEvidence;
    }>
  | Readonly<{ status: 'cancelled' | 'timed_out'; evidence: NormalizedInvocationEvidence }>;
