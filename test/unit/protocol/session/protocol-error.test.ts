import { expect, test } from 'vitest';

import {
  protocolFailureDetails,
  sanitizeDiagnosticDetails,
} from '../../../../src/protocol/session/errors/protocol-error.js';

test('keeps bounded ACP error code and nested provider data while redacting sensitive keys', () => {
  const error = Object.assign(new Error('rate limit exceeded'), {
    code: -32_000,
    data: { provider: 'openrouter', token: 'private-token', retryAfter: 3 },
  });

  expect(protocolFailureDetails(error)).toEqual({
    code: -32_000,
    data: { provider: 'openrouter', retryAfter: 3, token: '[redacted]' },
    message: 'rate limit exceeded',
    name: 'Error',
  });
});

test('redacts credential-shaped messages and enforces the encoded diagnostic budget', () => {
  const details = protocolFailureDetails(
    Object.assign(new Error('Authorization: Bearer synthetic-review-secret'), {
      data: { token: 'nested-secret', payload: 'x'.repeat(20_000) },
    }),
  );

  expect(JSON.stringify(details)).not.toContain('synthetic-review-secret');
  expect(JSON.stringify(details)).not.toContain('nested-secret');
  expect(new TextEncoder().encode(JSON.stringify(details)).byteLength).toBeLessThanOrEqual(8_192);
});

test('redacts configured secrets inside diagnostic arrays', () => {
  const details = protocolFailureDetails(
    { data: { values: ['opaque-secret', { nested: 'opaque-secret' }] } },
    (value) => value.replaceAll('opaque-secret', '[redacted]'),
  );

  expect(details).toEqual({
    data: { values: ['[redacted]', { nested: '[nested diagnostic omitted]' }] },
  });
});

test('sanitizes diagnostics supplied by a direct fault boundary', () => {
  const details = sanitizeDiagnosticDetails({
    message: 'Authorization: Bearer synthetic-review-secret',
    data: { token: 'nested-secret', payload: 'x'.repeat(20_000) },
  });

  expect(JSON.stringify(details)).not.toContain('synthetic-review-secret');
  expect(JSON.stringify(details)).not.toContain('nested-secret');
  expect(new TextEncoder().encode(JSON.stringify(details)).byteLength).toBeLessThanOrEqual(8_192);
});

test('normalizes primitive and plain object protocol failures', () => {
  expect(protocolFailureDetails('Bearer primitive-secret')).toEqual({
    message: 'Bearer [redacted]',
  });
  expect(protocolFailureDetails(null)).toEqual({ message: 'null' });
  expect(protocolFailureDetails(42)).toEqual({ message: '42' });
  expect(
    protocolFailureDetails({
      code: 'transport_failed',
      message: 'provider failed',
      name: 'ProviderError',
      data: { values: ['one', { password: 'secret' }] },
    }),
  ).toEqual({
    code: 'transport_failed',
    data: { values: ['one', { password: '[redacted]' }] },
    message: 'provider failed',
    name: 'ProviderError',
  });
  expect(protocolFailureDetails({})).toEqual({ message: 'Provider request failed.' });
  expect(protocolFailureDetails(new Error('without data'))).toMatchObject({
    message: 'without data',
  });
  expect(
    protocolFailureDetails(
      Object.assign(new Error('invalid code'), { code: { unsupported: true } }),
    ),
  ).not.toHaveProperty('code');
  expect(protocolFailureDetails({ code: 17 })).toMatchObject({ code: 17 });
  expect(protocolFailureDetails({ message: 'only message' })).toMatchObject({
    message: 'only message',
  });
  expect(protocolFailureDetails({ name: 'OnlyName' })).toMatchObject({ name: 'OnlyName' });
  expect(protocolFailureDetails({ data: undefined })).toEqual({
    message: 'Provider request failed.',
  });
});

test('bounds nested diagnostic shapes and redacts credential-shaped values', () => {
  const nested: Record<string, unknown> = { value: 'deep' };
  nested.next = { next: { next: { next: 'omitted' } } };
  const details = protocolFailureDetails({
    data: {
      authorization: 'Bearer nested-secret',
      values: [nested, 'api_key=embedded-secret'],
      extra: 'x'.repeat(10_000),
    },
  });
  const encoded = JSON.stringify(details);
  expect(encoded).not.toContain('nested-secret');
  expect(encoded).not.toContain('embedded-secret');
  expect(encoded).toContain('[nested diagnostic omitted]');
  const exhausted = protocolFailureDetails({
    data: Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [`field${index}`, 'x'.repeat(2_048)]),
    ),
  });
  expect(exhausted).toEqual({ message: 'Provider diagnostic exceeded the size limit.' });
  expect(protocolFailureDetails({ data: Symbol('unsupported') })).toMatchObject({
    data: '[diagnostic value omitted]',
  });
});

test('drops oversized diagnostic object structure while retaining bounded identity', () => {
  const hugeKeys = Object.fromEntries(
    Array.from({ length: 16 }, (_, index) => [`${'k'.repeat(1_000)}${index}`, 'v']),
  );
  const details = sanitizeDiagnosticDetails({
    code: 'transport_failed',
    message: 'provider failed',
    name: 'ProviderError',
    data: hugeKeys,
  });
  expect(details).toEqual({
    code: 'transport_failed',
    message: 'provider failed',
    name: 'ProviderError',
  });
  expect(new TextEncoder().encode(JSON.stringify(details)).byteLength).toBeLessThanOrEqual(8_192);
});
