import type { ProcessOutputSink } from '../process-supervision-port/index.js';
import type { RedactionChannel } from '../redaction/index.js';
import { buildBoundedOutputSink } from './build-bounded-output-sink.js';
import type { RedactingBoundedOutputSink } from './redacting-bounded-output-sink.js';

export const wrapRedactionChannelAsBoundedOutputSink = (request: {
  readonly channel: RedactionChannel;
  readonly downstream: ProcessOutputSink;
  readonly maxBytes: number;
}): RedactingBoundedOutputSink => buildBoundedOutputSink(request);
