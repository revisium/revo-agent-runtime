import type { AgentValidationDetails } from '../spec/index.js';
import type { BoundedRawResponseEvidence } from './bounded-raw-response-evidence.js';
import type { ProcessExitObservation } from './process-supervision-port/index.js';
import type { RawFinalResponseEligibility } from './raw-final-response-eligibility.js';
import type { ResultParserUsage } from './result-parser/index.js';

export interface NormalizedInvocationEvidence {
  readonly exit?: ProcessExitObservation;
  readonly usage?: ResultParserUsage;
  readonly rawResponse?: BoundedRawResponseEvidence;
  readonly rawFinalResponseEligibility?: RawFinalResponseEligibility;
  readonly schemaDiagnostics?: AgentValidationDetails;
}
