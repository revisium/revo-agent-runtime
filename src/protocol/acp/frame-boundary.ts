const newline = 0x0a;

class AcpFrameTooLargeError extends Error {
  constructor() {
    super('ACP frame exceeds the byte limit.');
    this.name = 'AcpFrameTooLargeError';
  }
}

const assertByteLimit = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid ACP frame limit.');
};

/** Rejects an oversized NDJSON frame before the downstream parser can retain it. */
export const boundAcpInput = (
  input: ReadableStream<Uint8Array>,
  maxFrameBytes: number,
  observeFrame?: (frame: Uint8Array) => void,
): ReadableStream<Uint8Array> => {
  assertByteLimit(maxFrameBytes);
  let frameBytes = 0;
  let observedFrame: number[] | undefined = observeFrame === undefined ? undefined : [];
  return input.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        for (const byte of chunk) {
          if (byte === newline) {
            frameBytes = 0;
            if (observedFrame !== undefined) {
              observeFrame?.(Uint8Array.from(observedFrame));
              observedFrame = [];
            }
          } else {
            if ((frameBytes += 1) > maxFrameBytes) throw new AcpFrameTooLargeError();
            observedFrame?.push(byte);
          }
        }
        controller.enqueue(chunk);
      },
    }),
  );
};
