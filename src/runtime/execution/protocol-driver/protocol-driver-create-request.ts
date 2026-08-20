import type { ExecutionBinding } from '../execution-binding.js';
import type { ResultParserPort } from '../result-parser/index.js';

export interface ProtocolDriverCreateRequest {
  readonly invocationId: string;
  readonly delivery: ExecutionBinding['delivery'];
  readonly cancellationSupported: boolean;
  readonly promptBytes?: Uint8Array;
  readonly canonicalResultSchemaBytes?: Uint8Array;
  readonly resultParser?: ResultParserPort;
}
