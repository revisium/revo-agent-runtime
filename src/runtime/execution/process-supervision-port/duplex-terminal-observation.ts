import type { AgentValidationDetails, JsonObject } from '../../spec/index.js';
import type { BoundedRawResponseEvidence } from '../bounded-raw-response-evidence.js';
import type { InterimDuplexPrimaryFailure } from '../interim-duplex-primary-failure.js';
import type { ResultParserUsage } from '../result-parser/index.js';
import type { ProcessExitObservation } from './process-exit-observation.js';
import type { RetainedCleanupAuthority } from './retained-cleanup-authority.js';

export type DuplexTerminalObservation =
  | Readonly<{
      status: 'completed';
      spawnedAt: number;
      exit: ProcessExitObservation;
      rawResponse?: BoundedRawResponseEvidence;
      parsedResponse?: JsonObject;
      usage?: ResultParserUsage;
    }>
  | Readonly<{
      status: 'cancelled';
      spawnedAt: number;
      exit: ProcessExitObservation;
      usage?: ResultParserUsage;
      rawResponse?: BoundedRawResponseEvidence;
    }>
  | Readonly<{
      status: 'failed';
      spawnedAt: number;
      exit: ProcessExitObservation;
      primary: InterimDuplexPrimaryFailure;
      usage?: ResultParserUsage;
      rawResponse?: BoundedRawResponseEvidence;
    }>
  | Readonly<{
      status: 'cleanup_uncertain';
      primary: Readonly<{ kind: 'cancelled' }> | InterimDuplexPrimaryFailure;
      authority: RetainedCleanupAuthority;
      exit?: ProcessExitObservation;
      usage?: ResultParserUsage;
      rawResponse?: BoundedRawResponseEvidence;
      schemaDiagnostics?: AgentValidationDetails;
    }>;
