import type { ProcessOutputSink } from '../process-supervision-port/index.js';

export interface RedactingOutputGuardRequest {
  readonly downstream: ProcessOutputSink;
  readonly secretValues: readonly string[];
  readonly maxBytes: number;
}
