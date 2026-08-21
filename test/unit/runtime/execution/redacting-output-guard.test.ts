import { expect, test } from 'vitest';

import {
  createRedactingBoundedOutputSink,
  wrapRedactionChannelAsBoundedOutputSink,
  type ProcessOutputSink,
  type RedactionChannel,
} from '../../../../src/runtime/execution/index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const collectingSink = (): {
  sink: ProcessOutputSink;
  output: () => string;
  endCount: () => number;
} => {
  const chunks: Uint8Array[] = [];
  let ends = 0;
  return {
    sink: {
      write: (chunk) => {
        chunks.push(new Uint8Array(chunk));
        return Promise.resolve();
      },
      end: () => {
        ends += 1;
        return Promise.resolve();
      },
    },
    output: () => decoder.decode(Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))),
    endCount: () => ends,
  };
};

const channelProbe = (): {
  factory: () => RedactionChannel;
  disposeCount: () => number;
} => {
  let disposals = 0;
  return {
    factory: () => ({
      feed: (chunk) => new Uint8Array(chunk),
      flush: () => new Uint8Array(),
      dispose: () => {
        disposals += 1;
      },
    }),
    disposeCount: () => disposals,
  };
};

test('bounds redacted output and never forwards bytes after truncation', async () => {
  const downstream = collectingSink();
  const guard = createRedactingBoundedOutputSink({
    downstream: downstream.sink,
    secretValues: [],
    maxBytes: 5,
  });

  expect(guard.truncated()).toBe(false);
  await guard.write(encoder.encode('abc'));
  expect(downstream.output()).toBe('abc');
  expect(guard.truncated()).toBe(false);

  await guard.write(encoder.encode('def'));
  expect(downstream.output()).toBe('abcde');
  expect(guard.truncated()).toBe(true);

  await guard.write(encoder.encode('not-forwarded'));
  const beforeEnd = downstream.output();
  await guard.end();
  expect(downstream.output()).toBe(beforeEnd);
  expect(downstream.endCount()).toBe(1);
});

test('disposes the channel exactly once after normal end', async () => {
  const probe = channelProbe();
  const downstream = collectingSink();
  const guard = createRedactingBoundedOutputSink(
    { downstream: downstream.sink, secretValues: [], maxBytes: 10 },
    probe.factory,
  );

  await guard.end();
  expect(probe.disposeCount()).toBe(1);
  guard.dispose();
  expect(probe.disposeCount()).toBe(1);
});

test('does not forward a recognizable registered secret prefix at normal end', async () => {
  const recognizablePrefix = ['sk', 'live', '51'].join('_');
  const downstream = collectingSink();
  const guard = createRedactingBoundedOutputSink({
    downstream: downstream.sink,
    secretValues: [`${recognizablePrefix}H8xJ9superSecretApiKeyValue`],
    maxBytes: 1_024,
  });

  await guard.write(encoder.encode(`request failed for token ${recognizablePrefix}`));
  expect(downstream.output()).toBe('');
  await guard.end();

  expect(downstream.output()).toBe('request failed for token [REDACTED]');
  expect(downstream.output()).not.toContain(recognizablePrefix);
});

test('does not forward a quoted value split after pre-value whitespace overflow', async () => {
  const recognizableValue = 'super secret value';
  const downstream = collectingSink();
  const guard = createRedactingBoundedOutputSink({
    downstream: downstream.sink,
    secretValues: [],
    maxBytes: 100_000,
  });

  await guard.write(encoder.encode(`PASSWORD=${' '.repeat(65_537)}`));
  await guard.write(encoder.encode(`"${recognizableValue}";after`));
  await guard.end();

  expect(downstream.output().endsWith('[REDACTED]";after')).toBe(true);
  expect(downstream.output()).not.toContain(recognizableValue);
});

test('disposes the channel exactly once after downstream write rejection', async () => {
  const probe = channelProbe();
  const guard = createRedactingBoundedOutputSink(
    {
      downstream: {
        write: () => Promise.reject(new Error('write failed')),
        end: () => Promise.resolve(),
      },
      secretValues: [],
      maxBytes: 10,
    },
    probe.factory,
  );

  await expect(guard.write(encoder.encode('output'))).rejects.toThrow('write failed');
  expect(probe.disposeCount()).toBe(1);
  guard.dispose();
  expect(probe.disposeCount()).toBe(1);
});

test('disposes the channel exactly once when truncation is reached', async () => {
  const probe = channelProbe();
  const downstream = collectingSink();
  const guard = createRedactingBoundedOutputSink(
    { downstream: downstream.sink, secretValues: [], maxBytes: 1 },
    probe.factory,
  );

  await guard.write(encoder.encode('overflow'));
  expect(guard.truncated()).toBe(true);
  expect(probe.disposeCount()).toBe(1);
  guard.dispose();
  expect(probe.disposeCount()).toBe(1);
});

test('wraps an injected redaction channel with the same byte bound and disposal semantics', async () => {
  const probe = channelProbe();
  const downstream = collectingSink();
  const guard = wrapRedactionChannelAsBoundedOutputSink({
    channel: probe.factory(),
    downstream: downstream.sink,
    maxBytes: 4,
  });

  await guard.write(encoder.encode('abcdef'));
  expect(downstream.output()).toBe('abcd');
  expect(guard.truncated()).toBe(true);
  expect(probe.disposeCount()).toBe(1);

  await guard.end();
  expect(downstream.endCount()).toBe(1);
  guard.dispose();
  expect(probe.disposeCount()).toBe(1);
});
