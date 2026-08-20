import type { ProcessInputSink, ProcessOutputSink } from '../process-supervision-port/index.js';
import type { ProtocolAttachResult } from './protocol-attach-result.js';

export interface PreparedProtocolSession {
  readonly protocolOutput: ProcessOutputSink;
  attach(input: ProcessInputSink): Promise<ProtocolAttachResult>;
  dispose(): void;
}
