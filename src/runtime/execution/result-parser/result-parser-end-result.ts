import type { JsonObject } from '../../spec/index.js';
import type { RawResponseDiagnostic } from '../raw-response-diagnostic.js';
import type { ParserFailureReason } from './parser-failure-reason.js';
import type { ResultParserUsage } from './result-parser-usage.js';

export type ResultParserEndResult =
  | Readonly<{
      status: 'completed';
      response: JsonObject;
      usage?: ResultParserUsage;
      raw?: RawResponseDiagnostic;
    }>
  | Readonly<{ status: 'failed'; reason: ParserFailureReason; raw?: RawResponseDiagnostic }>;
