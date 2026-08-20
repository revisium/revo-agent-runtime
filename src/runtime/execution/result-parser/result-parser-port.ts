import type { ResultParserEndResult } from './result-parser-end-result.js';
import type { ResultParserId } from './result-parser-id.js';
import type { ResultParserWriteResult } from './result-parser-write-result.js';

export interface ResultParserPort {
  readonly id: ResultParserId;
  writeProtocolBytes(bytes: Uint8Array): ResultParserWriteResult;
  endProtocolBytes(): ResultParserEndResult;
  dispose(): void;
}
