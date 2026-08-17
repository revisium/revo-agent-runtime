import { createRedactionChannel } from '../redaction/index.js';
import type { RedactionChannel } from '../redaction/index.js';
import type { RedactingBoundedOutputSink } from './redacting-bounded-output-sink.js';
import type { RedactingOutputGuardRequest } from './redacting-output-guard-request.js';

type RedactionChannelFactory = (secretValues: readonly string[]) => RedactionChannel;

export const createRedactingBoundedOutputSink = (
  request: RedactingOutputGuardRequest,
  channelFactory: RedactionChannelFactory = createRedactionChannel,
): RedactingBoundedOutputSink => {
  if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1)
    throw new Error('Output byte limit must be a positive safe integer.');

  const channel = channelFactory(request.secretValues);
  let forwardedBytes = 0;
  let isTruncated = false;
  let disposed = false;
  let ended = false;

  const disposeChannel = (): void => {
    if (disposed) return;
    disposed = true;
    channel.dispose();
  };

  const truncate = (): void => {
    if (isTruncated) return;
    isTruncated = true;
    channel.flush();
    disposeChannel();
  };

  const forward = async (chunk: Uint8Array): Promise<void> => {
    if (isTruncated || chunk.byteLength === 0) return;
    const available = request.maxBytes - forwardedBytes;
    if (chunk.byteLength <= available) {
      await request.downstream.write(chunk);
      forwardedBytes += chunk.byteLength;
      return;
    }
    if (available > 0) {
      await request.downstream.write(chunk.subarray(0, available));
      forwardedBytes += available;
    }
    truncate();
  };

  return Object.freeze({
    write: async (chunk: Uint8Array): Promise<void> => {
      if (isTruncated) return;
      try {
        const redacted = channel.feed(chunk);
        await forward(redacted);
      } catch (error: unknown) {
        disposeChannel();
        throw error;
      }
    },
    end: async (): Promise<void> => {
      if (ended) return;
      ended = true;
      try {
        if (!isTruncated) {
          const final = channel.flush();
          await forward(final);
        }
        await request.downstream.end();
      } finally {
        disposeChannel();
      }
    },
    dispose: (): void => disposeChannel(),
    truncated: (): boolean => isTruncated,
  });
};
