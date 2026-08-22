import type { JsonObject } from '../../spec/index.js';
import type { BoundedRawResponseEvidence } from '../bounded-raw-response-evidence.js';
import type { ParserFailureReason } from './parser-failure-reason.js';
import type { ResultParserUsage } from './result-parser-usage.js';

export type ResultParserEndResult =
  | Readonly<{
      status: 'completed';
      response: JsonObject;
      usage?: ResultParserUsage;
      raw?: BoundedRawResponseEvidence;
    }>
  | Readonly<{ status: 'failed'; reason: ParserFailureReason; raw?: BoundedRawResponseEvidence }>;
