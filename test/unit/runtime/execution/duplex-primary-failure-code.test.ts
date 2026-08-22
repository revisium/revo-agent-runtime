import { expect, test } from 'vitest';

import { duplexPrimaryFailureCode } from '../../../../src/runtime/execution/index.js';

const cleanupFailure = Object.freeze({
  kind: 'process_cleanup_failed' as const,
  cause: 'leader_reap_timeout' as const,
  evidence: Object.freeze({
    trigger: 'natural_exit' as const,
    cause: 'leader_reap_timeout' as const,
    termSent: true,
    killSent: false,
    lastKnownGroupState: 'absent' as const,
    leaderReapState: 'pending' as const,
  }),
});

test.each<readonly [Parameters<typeof duplexPrimaryFailureCode>[0], string]>([
  [Object.freeze({ kind: 'stdout_sink_failed' }), 'revo.agent.output_write_failed'],
  [Object.freeze({ kind: 'stderr_sink_failed' }), 'revo.agent.output_write_failed'],
  [Object.freeze({ kind: 'protocol_sink_failed' }), 'revo.agent.protocol_failed'],
  [cleanupFailure, 'revo.agent.process_cleanup_failed'],
])('maps new duplex primary %o to %s', (primary, code) => {
  expect(duplexPrimaryFailureCode(primary)).toBe(code);
});

test.each([
  'attach',
  'stdin_write',
  'stdin_end',
  'protocol_write',
  'protocol_end',
  'parser_finish',
] as const)('maps %s operation timeout to protocol failure', (operation) => {
  expect(
    duplexPrimaryFailureCode(Object.freeze({ kind: 'duplex_operation_timeout', operation })),
  ).toBe('revo.agent.protocol_failed');
});

test.each(['stdout_write', 'stdout_end', 'stderr_write', 'stderr_end'] as const)(
  'maps %s operation timeout to output write failure',
  (operation) => {
    expect(
      duplexPrimaryFailureCode(Object.freeze({ kind: 'duplex_operation_timeout', operation })),
    ).toBe('revo.agent.output_write_failed');
  },
);
