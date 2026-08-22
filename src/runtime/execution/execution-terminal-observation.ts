import type { JsonObject } from '../spec/index.js';
import type { BoundedRawResponseEvidence } from './bounded-raw-response-evidence.js';
import type { InterimDuplexPrimaryFailure } from './interim-duplex-primary-failure.js';
import type { ProcessExitObservation } from './process-supervision-port/index.js';
import type { ResultParserUsage } from './result-parser/index.js';

export type InvocationTerminalObservation =
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
    }>;
