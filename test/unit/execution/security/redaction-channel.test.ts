import { expect, test } from 'vitest';

import { createRedactionChannel } from '../../../../src/execution/security/redaction/channel.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const redact = (chunks: readonly Uint8Array[], secrets: readonly string[] = []): string => {
  const channel = createRedactionChannel(secrets);
  const output = chunks.map((chunk) => channel.feed(chunk));
  output.push(channel.flush());
  return decoder.decode(Buffer.concat(output));
};

test('removes a literal secret at every possible byte split', () => {
  const source = encoder.encode('before 🔐-secret after');

  for (let split = 0; split <= source.byteLength; split += 1) {
    const output = redact([source.subarray(0, split), source.subarray(split)], ['🔐-secret']);
    expect(output, `split ${split}`).toBe('before [REDACTED] after');
  }
});

test.each([
  ['api_key = token-value;', 'api_key = [REDACTED];'],
  ['API_TOKEN: "token value";', 'API_TOKEN: "[REDACTED]";'],
  ['access_token=access-value\n', 'access_token=[REDACTED]\n'],
  ['AUTH_TOKEN=auth-value&next=true', 'AUTH_TOKEN=[REDACTED]&next=true'],
  ["CLIENT_SECRET='client value'", "CLIENT_SECRET='[REDACTED]'"],
  ['PASSWORD=password-value\r\n', 'PASSWORD=[REDACTED]\r\n'],
  ['Authorization: Basic credential\n', 'Authorization: [REDACTED]\n'],
  ['Proxy-Authorization: Bearer proxy-token\n', 'Proxy-Authorization: [REDACTED]\n'],
  ['Bearer standalone-token, next', 'Bearer [REDACTED], next'],
  ['-----BEGIN RSA PRIVATE KEY-----private material-----END RSA PRIVATE KEY-----', '[REDACTED]'],
])('redacts the approved built-in secret grammar in %j', (source, expected) => {
  expect(redact([encoder.encode(source)])).toBe(expected);
});

test('keeps channel carry independent', () => {
  const stdout = createRedactionChannel(['shared-secret']);
  const stderr = createRedactionChannel(['shared-secret']);

  expect(decoder.decode(stdout.feed(encoder.encode('shared-')))).toBe('');
  expect(decoder.decode(stderr.feed(encoder.encode('ordinary stderr')))).toBe('ordinary stderr');
  expect(decoder.decode(stdout.feed(encoder.encode('secret')))).toBe('[REDACTED]');
});

test('bounds an unterminated built-in candidate without releasing its secret tail', () => {
  expect(redact([encoder.encode(`PASSWORD=${'x'.repeat(65_537)}`)])).toBe('PASSWORD=[REDACTED]');
});
