import type { AgentValidationDetails, JsonObject } from '../spec/index.js';
import type { NormalizedInvocationFailureReason } from './normalized-invocation-failure-reason.js';
import type { RawResponseDiagnostic } from './raw-response-diagnostic.js';

export type NormalizedInvocationOutcome =
  | Readonly<{ status: 'succeeded'; value: JsonObject }>
  | Readonly<{
      status: 'failed';
      reason: NormalizedInvocationFailureReason;
      diagnostics?: AgentValidationDetails;
      rawResponse?: RawResponseDiagnostic;
    }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'timed_out' }>;
