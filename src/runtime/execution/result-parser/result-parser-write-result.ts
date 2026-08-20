import type { RawResponseDiagnostic } from '../raw-response-diagnostic.js';
import type { ParserFailureReason } from './parser-failure-reason.js';

export type ResultParserWriteResult =
  | Readonly<{ status: 'observed' }>
  | Readonly<{ status: 'failed'; reason: ParserFailureReason; raw?: RawResponseDiagnostic }>;
