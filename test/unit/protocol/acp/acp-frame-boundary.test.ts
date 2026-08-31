import { expect, test } from 'vitest';

import { boundAcpInput } from '../../../../src/protocol/acp/frame-boundary.js';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const inputFrom = (chunks: readonly string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(bytes(chunk));
      controller.close();
    },
  });

const readText = async (input: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = input.getReader();
  const chunks: Uint8Array[] = [];
  const readNext = async (): Promise<string> => {
    const next = await reader.read();
    if (next.done) return new TextDecoder().decode(Buffer.concat(chunks));
    chunks.push(next.value);
    return readNext();
  };
  try {
    return await readNext();
  } finally {
    reader.releaseLock();
  }
};

test('bounds every ACP frame before the SDK parser can retain it', async () => {
  const input = boundAcpInput(inputFrom(['1234', '5678', '9']), 8);

  await expect(readText(input)).rejects.toThrow('ACP frame exceeds the byte limit.');
});

test('resets the frame budget only at an NDJSON newline', async () => {
  const input = boundAcpInput(inputFrom(['1234\n56', '78\n']), 4);

  await expect(readText(input)).resolves.toBe('1234\n5678\n');
});

test('rejects an invalid byte boundary before reading the transport', () => {
  expect(() => boundAcpInput(inputFrom([]), 0)).toThrow('Invalid ACP frame limit.');
});

test('observes only complete bounded frames across transport chunks', async () => {
  const frames: string[] = [];
  const input = boundAcpInput(inputFrom(['{"one":', '1}\n{"two":2}\n']), 32, (frame) =>
    frames.push(new TextDecoder().decode(frame)),
  );

  await readText(input);

  expect(frames).toEqual(['{"one":1}', '{"two":2}']);
});
