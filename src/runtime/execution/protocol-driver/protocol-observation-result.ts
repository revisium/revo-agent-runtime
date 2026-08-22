import type { JsonObject } from '../../spec/index.js';
import type { BoundedRawResponseEvidence } from '../bounded-raw-response-evidence.js';
import type { ParserFailureReason, ResultParserUsage } from '../result-parser/index.js';

export type ProtocolObservationResult =
  | Readonly<{
      status: 'completed';
      response: JsonObject;
      usage?: ResultParserUsage;
      rawResponse?: BoundedRawResponseEvidence;
    }>
  | Readonly<{
      status: 'failed';
      failure:
        | Readonly<{ kind: 'protocol_sink_failed' }>
        | Readonly<{ kind: 'parser_failed'; reason: ParserFailureReason }>;
      rawResponse?: BoundedRawResponseEvidence;
    }>;
