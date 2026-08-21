import type { JsonObject } from '../spec/index.js';
import type { ResultParserUsage } from './result-parser/index.js';

export type InvocationTerminalObservation =
  | Readonly<{
      status: 'completed';
      rawResponse?: Uint8Array;
      parsedResponse?: JsonObject;
      usage?: ResultParserUsage;
    }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'failed' }>;
