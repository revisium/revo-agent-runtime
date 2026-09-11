import { expect, test } from 'vitest';

import {
  protocolFault,
  withStderrDiagnostic,
} from '../../../../../../src/execution/session/interpreter/provider/fault.js';

test('attaches bounded stderr to faults with and without existing diagnostics', () => {
  const base = protocolFault(
    { code: 'transport_failed', message: 'failed', retryable: false },
    'session_running',
    undefined,
  );
  expect(withStderrDiagnostic(base, { stderr: 'provider failed', truncated: false })).toMatchObject(
    {
      details: { diagnostic: { stderr: 'provider failed' } },
    },
  );

  expect(
    withStderrDiagnostic(
      { ...base, details: { diagnostic: { provider: { message: 'provider failed' } } } },
      { stderr: 'provider failed again', truncated: false },
    ),
  ).toMatchObject({
    details: {
      diagnostic: { provider: { message: 'provider failed' }, stderr: 'provider failed again' },
    },
  });

  const evidence = withStderrDiagnostic(base, {
    stderr: `${'startup '.repeat(500)}PRIMARY_RATE_LIMIT_CAUSE${'tail '.repeat(500)}`,
    truncated: true,
  });
  expect(evidence.details?.diagnostic).toMatchObject({
    stderr: expect.stringContaining('PRIMARY_RATE_LIMIT_CAUSE'),
  });

  expect(
    withStderrDiagnostic(
      {
        ...base,
        details: {
          diagnostic: {
            provider: {
              message: 'opaque-configured-secret',
              data: { count: 1, enabled: true, empty: null, tags: ['provider'] },
            },
          },
        },
      },
      { stderr: '', truncated: true },
      (value) => value.replaceAll('opaque-configured-secret', '[REDACTED]'),
    ),
  ).not.toMatchObject({
    details: { diagnostic: { provider: { message: 'opaque-configured-secret' } } },
  });

  const existing = {
    ...base,
    details: { diagnostic: ['unexpected'] as never },
  };
  expect(
    withStderrDiagnostic(existing, { stderr: 'provider failed', truncated: true }),
  ).toMatchObject({
    details: { diagnostic: { stderr: 'provider failed', stderrTruncated: true } },
  });
});

test('maps configuration selection protocol failures to stable fault codes', () => {
  expect(
    protocolFault(
      { code: 'configuration_value_unsupported', message: 'unsupported', retryable: false },
      'session_running',
      undefined,
    ),
  ).toMatchObject({ code: 'revo.agent.configuration_value_unsupported' });
});

test('uses a structured provider reason as the actionable fault message', () => {
  expect(
    protocolFault(
      {
        code: 'transport_failed',
        message: 'Provider rejected the request. configured-secret',
        retryable: false,
      },
      'session_running',
      (value) => value.replace('configured-secret', '[redacted]'),
    ),
  ).toMatchObject({ message: 'Provider rejected the request. [redacted]' });
});

test('keeps the generic fault message for blank structured reasons', () => {
  expect(
    protocolFault(
      { code: 'transport_failed', message: '   ', retryable: false },
      'session_running',
      undefined,
    ),
  ).toMatchObject({ message: 'The provider session protocol operation failed.' });
});

test('bounds a structured reason before it becomes a public fault message', () => {
  const result = protocolFault(
    { code: 'transport_failed', message: 'x'.repeat(10_000), retryable: false },
    'session_running',
    undefined,
  );
  expect(result.message).toHaveLength(2_048);
});

test('bounds the complete diagnostic envelope', () => {
  const result = protocolFault(
    {
      code: 'transport_failed',
      message: 'Provider rejected the request.',
      details: { data: { payload: 'x'.repeat(10_000) } },
      retryable: false,
    },
    'session_running',
    undefined,
  );
  expect(
    new TextEncoder().encode(JSON.stringify(result.details?.diagnostic)).byteLength,
  ).toBeLessThanOrEqual(8_192);
});
