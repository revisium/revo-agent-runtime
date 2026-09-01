import { expect, test, vi } from 'vitest';

import { createRedactionChannel } from '../../../../src/execution/security/redaction/channel.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const feedText = (channel: ReturnType<typeof createRedactionChannel>, value: string): string =>
  decoder.decode(channel.feed(encoder.encode(value)));
test('redacts split literal secrets and the complete built-in grammar', () => {
  const split = createRedactionChannel(['abc123']);

  expect(feedText(split, 'prefix abc')).toBe('');
  expect(feedText(split, '123 suffix')).toBe('prefix [REDACTED] suffix');

  const cases = [
    ['API_KEY=abcdef;', 'API_KEY=[REDACTED];'],
    ['client_secret: "value with spaces";', 'client_secret: "[REDACTED]";'],
    ['Authorization: Bearer eyJhbGciOi...\n', 'Authorization: [REDACTED]\n'],
    ['Bearer sometoken,', 'Bearer [REDACTED],'],
    ['-----BEGIN RSA PRIVATE KEY-----private-----END RSA PRIVATE KEY-----', '[REDACTED]'],
  ] as const;

  for (const [input, expected] of cases) {
    const channel = createRedactionChannel([]);
    expect(feedText(channel, input)).toBe(expected);
  }

  const excluded =
    'TOKEN=value SECRET=value CREDENTIAL=value PASSWORD_HASH=value X_API_KEY=value API_KEY_ID=value CLIENT_SECRET_VALUE=value';
  const channel = createRedactionChannel([]);
  expect(feedText(channel, excluded)).toBe(excluded);
});

test('keeps stdout and stderr matching state independent', () => {
  const stdout = createRedactionChannel(['abc123']);
  const stderr = createRedactionChannel(['abc123']);

  expect(feedText(stdout, 'abc')).toBe('');
  expect(feedText(stderr, '123')).toBe('123');
  expect(decoder.decode(stdout.flush())).toBe('[REDACTED]');
  expect(decoder.decode(stderr.flush())).toBe('');
});

test('bounds candidate carry, flushes safely, and selects the longest overlap', () => {
  const keyOverflow = createRedactionChannel([]);
  expect(feedText(keyOverflow, `API_KEY=${'a'.repeat(65_537)}`)).toBe('API_KEY=[REDACTED]');
  expect(feedText(keyOverflow, 'still-secret;after')).toBe(';after');
  expect(decoder.decode(keyOverflow.flush())).toBe('');

  const pemOverflow = createRedactionChannel([]);
  expect(feedText(pemOverflow, `-----BEGIN RSA PRIVATE KEY-----${'a'.repeat(65_537)}`)).toBe(
    '[REDACTED]',
  );
  expect(feedText(pemOverflow, 'more-----END RSA PRIVATE KEY-----after')).toBe('after');

  const discardedAtEnd = createRedactionChannel([]);
  expect(feedText(discardedAtEnd, `PASSWORD=${'a'.repeat(65_537)}`)).toBe('PASSWORD=[REDACTED]');
  expect(decoder.decode(discardedAtEnd.flush())).toBe('');

  const finalCandidate = createRedactionChannel([]);
  expect(feedText(finalCandidate, 'PASSWORD=unfinished')).toBe('');
  expect(decoder.decode(finalCandidate.flush())).toBe('PASSWORD=[REDACTED]');

  const builtInLongest = createRedactionChannel(['API_KEY']);
  expect(feedText(builtInLongest, 'API_KEY=abcdef;')).toBe('API_KEY=[REDACTED];');
  const literalLongest = createRedactionChannel(['API_KEY=abcdef;tail']);
  expect(feedText(literalLongest, 'API_KEY=abcdef;tail')).toBe('[REDACTED]');
});

test('bounds pre-value whitespace and discards the following secret value', () => {
  const whitespace = ' '.repeat(200_000);
  const prefix = `PASSWORD=${whitespace}`;
  const channel = createRedactionChannel([]);

  const redactedPrefix = feedText(channel, prefix);
  expect(redactedPrefix).toHaveLength(prefix.length + '[REDACTED]'.length);
  expect(redactedPrefix.startsWith(prefix)).toBe(true);
  expect(redactedPrefix.endsWith('[REDACTED]')).toBe(true);
  const released = feedText(channel, 'value;after');
  expect(released).toBe(';after');
  expect(released).not.toContain('value');
  expect(decoder.decode(channel.flush())).toBe('');
});

test('discards a double-quoted value split after pre-value whitespace overflow', () => {
  const recognizableValue = 'super secret value';
  const channel = createRedactionChannel([]);

  expect(feedText(channel, `PASSWORD=${' '.repeat(65_537)}`).endsWith('[REDACTED]')).toBe(true);
  const released = feedText(channel, `"${recognizableValue}";after`);
  expect(released).toBe('";after');
  expect(released).not.toContain(recognizableValue);
  expect(decoder.decode(channel.flush())).toBe('');
});

test('discards a single-quoted value split after pre-value whitespace overflow', () => {
  const recognizableValue = 'super secret value';
  const channel = createRedactionChannel([]);

  expect(feedText(channel, `PASSWORD=${' '.repeat(65_537)}`).endsWith('[REDACTED]')).toBe(true);
  const released = feedText(channel, `'${recognizableValue}';after`);
  expect(released).toBe("';after");
  expect(released).not.toContain(recognizableValue);
  expect(decoder.decode(channel.flush())).toBe('');
});

test('disposes idempotently and fails closed after disposal', () => {
  const channel = createRedactionChannel(['secret']);
  expect(feedText(channel, 'prefix sec')).toBe('');

  expect(() => channel.dispose()).not.toThrow();
  expect(() => channel.dispose()).not.toThrow();
  expect(() => channel.feed(encoder.encode('ret'))).toThrow('Redaction channel is disposed.');
  expect(() => channel.flush()).toThrow('Redaction channel is disposed.');
});

test('finalizes an active key-value candidate shadowed by a partial literal', () => {
  const channel = createRedactionChannel(['API_KEY=abcdef-more']);

  expect(feedText(channel, 'API_KEY=abcdef')).toBe('');
  expect(decoder.decode(channel.flush())).toBe('API_KEY=[REDACTED]');
});

test('finalizes an active bearer candidate shadowed by a partial literal', () => {
  const channel = createRedactionChannel(['Bearer abcdef-more']);

  expect(feedText(channel, 'Bearer abcdef')).toBe('');
  expect(decoder.decode(channel.flush())).toBe('Bearer [REDACTED]');
});

test('finalizes an active PEM candidate shadowed by a partial literal', () => {
  const channel = createRedactionChannel([
    '-----BEGIN RSA PRIVATE KEY-----body-----END RSA PRIVATE KEY-----more',
  ]);

  expect(feedText(channel, '-----BEGIN RSA PRIVATE KEY-----body')).toBe('');
  expect(decoder.decode(channel.flush())).toBe('[REDACTED]');
});

test('does not release a recognizable registered secret prefix on final flush', () => {
  const recognizablePrefix = ['sk', 'live', '51'].join('_');
  const channel = createRedactionChannel([`${recognizablePrefix}H8xJ9superSecretApiKeyValue`]);

  expect(feedText(channel, `request failed for token ${recognizablePrefix}`)).toBe('');
  const output = decoder.decode(channel.flush());
  expect(output).toBe('request failed for token [REDACTED]');
  expect(output).not.toContain(recognizablePrefix);
});

test('clears retired carry storage after producing final output', () => {
  const input = 'prefix partial-secret';
  const fill = vi.spyOn(Uint8Array.prototype, 'fill');
  try {
    const channel = createRedactionChannel(['partial-secret-more']);
    expect(feedText(channel, input)).toBe('');

    expect(decoder.decode(channel.flush())).toBe('prefix [REDACTED]');
    expect(fill).toHaveBeenCalledWith(0);
  } finally {
    fill.mockRestore();
  }
});

test('clears retired carry storage after ordinary output release', () => {
  const fill = vi.spyOn(Uint8Array.prototype, 'fill');
  try {
    const channel = createRedactionChannel(['secret']);

    expect(feedText(channel, 'secret suffix')).toBe('[REDACTED] suffix');
    expect(fill).toHaveBeenCalledTimes(1);
    expect(fill).toHaveBeenCalledWith(0);
  } finally {
    fill.mockRestore();
  }
});

test('clears each retired carry storage during multi-chunk replacement', () => {
  const fill = vi.spyOn(Uint8Array.prototype, 'fill');
  try {
    const channel = createRedactionChannel(['secret']);
    expect(feedText(channel, 'prefix sec')).toBe('');
    expect(fill).not.toHaveBeenCalled();

    expect(feedText(channel, 'ret suffix')).toBe('prefix [REDACTED] suffix');
    expect(fill).toHaveBeenCalledTimes(2);
    expect(fill).toHaveBeenNthCalledWith(1, 0);
    expect(fill).toHaveBeenNthCalledWith(2, 0);
  } finally {
    fill.mockRestore();
  }
});

test.each([
  ['API_KEY', '[REDACTED]'],
  ['API_KEY   ', '[REDACTED]'],
  ['PASSWORD="unterminated', 'PASSWORD="[REDACTED]'],
  ['Authorization\t ', '[REDACTED]'],
  ['Bearer', '[REDACTED]'],
  ['Bearer   ', 'Bearer   [REDACTED]'],
  ['-----BEGIN ', '[REDACTED]'],
  ['-----BEGIN RSA', '[REDACTED]'],
])('fails closed for an incomplete built-in candidate %j', (input, expected) => {
  const channel = createRedactionChannel([]);
  expect(feedText(channel, input)).toBe('');
  expect(decoder.decode(channel.flush())).toBe(expected);
});
