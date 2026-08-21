import { createRedactionChannel } from '../redaction/index.js';
import type { RedactionChannel } from '../redaction/index.js';
import { buildBoundedOutputSink } from './build-bounded-output-sink.js';
import type { RedactingBoundedOutputSink } from './redacting-bounded-output-sink.js';
import type { RedactingOutputGuardRequest } from './redacting-output-guard-request.js';

type RedactionChannelFactory = (secretValues: readonly string[]) => RedactionChannel;

export const createRedactingBoundedOutputSink = (
  request: RedactingOutputGuardRequest,
  channelFactory: RedactionChannelFactory = createRedactionChannel,
): RedactingBoundedOutputSink => {
  const channel = channelFactory(request.secretValues);
  return buildBoundedOutputSink({
    channel,
    downstream: request.downstream,
    maxBytes: request.maxBytes,
  });
};
