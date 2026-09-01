import { expect, test } from 'vitest';

import { createRedactionChannel } from '../../../../src/execution/security/redaction/channel.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const feedText = (channel: ReturnType<typeof createRedactionChannel>, value: string): string =>
  decoder.decode(channel.feed(encoder.encode(value)));
test('accepts optional header whitespace and leaves non-secret near matches alone', () => {
  const channel = createRedactionChannel([]);

  expect(feedText(channel, 'Authorization \t: value\nBearer,value API_KEY_SUFFIX=x')).toBe(
    'Authorization \t: [REDACTED]\nBearer,value API_KEY_SUFFIX=x',
  );
});

test.each([
  ['PASSWORD=;', 'PASSWORD=;'],
  ['API_KEY?value', 'API_KEY?value'],
  ['Authorization=value', 'Authorization=value'],
  ['Authorization: value', 'Authorization: [REDACTED]'],
  ['Bea', '[REDACTED]'],
  ['Bearer ,', 'Bearer ,'],
])('handles built-in boundary case %j', (input, expected) => {
  const channel = createRedactionChannel([]);
  const output = feedText(channel, input) + decoder.decode(channel.flush());
  expect(output).toBe(expected);
});

test('rejects malformed and excessively long PEM begin labels', () => {
  const malformed = createRedactionChannel([]);
  expect(feedText(malformed, '-----BEGIN bad! PRIVATE KEY-----body')).toBe(
    '-----BEGIN bad! PRIVATE KEY-----body',
  );

  const longLabel = createRedactionChannel([]);
  const input = `-----BEGIN ${'A'.repeat(130)}`;
  expect(feedText(longLabel, input)).toBe(input);

  const partialBegin = createRedactionChannel([]);
  expect(feedText(partialBegin, '-----BEG')).toBe('');
  expect(decoder.decode(partialBegin.flush())).toBe('[REDACTED]');

  const oversizedCompleteLabel = createRedactionChannel([]);
  const complete = `-----BEGIN ${'A'.repeat(101)} PRIVATE KEY-----body\n`;
  expect(feedText(oversizedCompleteLabel, complete)).toBe(complete);
});

test('releases safe bytes before an overlong passive literal candidate', () => {
  const literal = `registered-${'x'.repeat(65_537)}`;
  const channel = createRedactionChannel([literal]);

  expect(feedText(channel, `safe ${literal.slice(0, -1)}`)).toBe('safe ');
  expect(feedText(channel, 'x tail')).toBe('[REDACTED] tail');
});

test('continues bounded byte discard until a delimiter arrives', () => {
  const channel = createRedactionChannel([]);
  expect(feedText(channel, `PASSWORD=${'x'.repeat(65_537)}`)).toBe('PASSWORD=[REDACTED]');
  expect(feedText(channel, 'still-secret')).toBe('');
  expect(feedText(channel, ';after')).toBe(';after');
});

test('continues bounded pre-value whitespace discard until a value arrives', () => {
  const channel = createRedactionChannel([]);
  expect(feedText(channel, `PASSWORD=${' '.repeat(65_537)}`).endsWith('[REDACTED]')).toBe(true);
  expect(feedText(channel, '   ')).toBe('');
  expect(feedText(channel, 'value;after')).toBe(';after');
});

test('retains only a possible PEM end-delimiter prefix while discarding', () => {
  const channel = createRedactionChannel([]);
  expect(feedText(channel, `-----BEGIN RSA PRIVATE KEY-----${'x'.repeat(65_537)}`)).toBe(
    '[REDACTED]',
  );
  expect(feedText(channel, 'body without delimiter')).toBe('');
  expect(feedText(channel, '-----END RSA PRIVATE')).toBe('');
  expect(feedText(channel, ' KEY-----after')).toBe('after');
});
