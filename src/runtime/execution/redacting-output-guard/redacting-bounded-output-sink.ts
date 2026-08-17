import type { ProcessOutputSink } from '../process-supervision-port/index.js';

export interface RedactingBoundedOutputSink extends ProcessOutputSink {
  dispose(): void;
  truncated(): boolean;
}
