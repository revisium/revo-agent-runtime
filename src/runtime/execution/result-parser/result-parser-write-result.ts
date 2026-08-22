import type { BoundedRawResponseEvidence } from '../bounded-raw-response-evidence.js';
import type { ParserFailureReason } from './parser-failure-reason.js';

export type ResultParserWriteResult =
  | Readonly<{ status: 'observed' }>
  | Readonly<{ status: 'failed'; reason: ParserFailureReason; raw?: BoundedRawResponseEvidence }>;
