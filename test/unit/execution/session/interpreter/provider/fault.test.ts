import { expect, test } from 'vitest';

import {
  protocolFault,
  withStderrDiagnostic,
} from '../../../../../../src/execution/session/interpreter/provider/fault.js';

test('attaches bounded stderr to faults with and without existing diagnostics', () => {
  const base = protocolFault(
    { code: 'transport_failed', message: 'failed', retryable: false },
    'session_running',
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
    ),
  ).toMatchObject({ code: 'revo.agent.configuration_value_unsupported' });
});
