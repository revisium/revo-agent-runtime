import type { JsonObject } from '../../spec/index.js';
import type { RawResponseDiagnostic } from '../raw-response-diagnostic.js';
import type { ParserFailureReason, ResultParserUsage } from '../result-parser/index.js';

export type ProtocolObservationResult =
  | Readonly<{
      status: 'completed';
      response: JsonObject;
      usage?: ResultParserUsage;
      rawResponse?: RawResponseDiagnostic;
    }>
  | Readonly<{
      status: 'failed';
      failure:
        | Readonly<{ kind: 'protocol_sink_failed' }>
        | Readonly<{ kind: 'parser_failed'; reason: ParserFailureReason }>;
      rawResponse?: RawResponseDiagnostic;
    }>;
