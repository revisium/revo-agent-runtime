import { expect, test } from 'vitest';

import {
  toAgentFault,
  type NormalizedInvocationFailure,
} from '../../../../src/runtime/execution/index.js';
import type { AgentFaultCode } from '../../../../src/runtime/spec/index.js';

const ALL_FAULT_CODES: readonly AgentFaultCode[] = [
  'revo.agent.definition_invalid',
  'revo.agent.definition_duplicate',
  'revo.agent.strategy_unsupported',
  'revo.agent.limit_invalid',
  'revo.agent.agent_unknown',
  'revo.agent.platform_unsupported',
  'revo.agent.probe_platform_unsupported',
  'revo.agent.probe_spawn_failed',
  'revo.agent.probe_timeout',
  'revo.agent.probe_output_too_large',
  'revo.agent.probe_process_failed',
  'revo.agent.probe_output_invalid',
  'revo.agent.probe_version_mismatch',
  'revo.agent.protocol_failed',
  'revo.agent.output_write_failed',
  'revo.agent.process_failed',
  'revo.agent.process_cleanup_failed',
  'revo.agent.result_missing',
  'revo.agent.result_too_large',
  'revo.agent.result_invalid_json',
  'revo.agent.result_not_object',
  'revo.agent.result_schema_mismatch',
  'revo.agent.scratch_cleanup_failed',
  'revo.agent.cancelled',
  'revo.agent.timeout',
  'revo.agent.internal',
];

test.each(ALL_FAULT_CODES)('maps every fault code %s to a non-empty message', (code) => {
  const failure: NormalizedInvocationFailure = Object.freeze({
    kind: 'parser',
    reason: 'invalid_json',
    code,
  });
  const fault = toAgentFault(failure);
  expect(fault.code).toBe(code);
  expect(fault.message.length).toBeGreaterThan(0);
  expect(fault.phase).toBe('collecting_result');
  expect(fault.retryable).toBe(false);
  expect(fault.details).toBeUndefined();
});

test('maps a duplex failure using its own code', () => {
  const failure: NormalizedInvocationFailure = Object.freeze({
    kind: 'duplex',
    primary: Object.freeze({ kind: 'process_failed' }),
    code: 'revo.agent.process_failed',
  });
  const fault = toAgentFault(failure);
  expect(fault.code).toBe('revo.agent.process_failed');
  expect(fault.details).toBeUndefined();
  expect(fault.phase).toBe('running');
});

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

test.each([
  [
    Object.freeze({
      kind: 'parser',
      reason: 'invalid_json',
      code: 'revo.agent.result_invalid_json',
    }),
    'collecting_result',
  ],
  [
    Object.freeze({ kind: 'result_schema', code: 'revo.agent.result_schema_mismatch' }),
    'collecting_result',
  ],
  [
    Object.freeze({
      kind: 'duplex',
      primary: Object.freeze({ kind: 'parser_failed', reason: 'invalid_json' }),
      code: 'revo.agent.result_invalid_json',
    }),
    'collecting_result',
  ],
  [
    Object.freeze({
      kind: 'duplex',
      primary: Object.freeze({ kind: 'result_schema_failed' }),
      code: 'revo.agent.result_schema_mismatch',
    }),
    'collecting_result',
  ],
  [Object.freeze({ kind: 'finalization', code: 'revo.agent.output_write_failed' }), 'finalizing'],
] as const)('maps %s failures to the owning phase', (failure, phase) => {
  expect(toAgentFault(failure as NormalizedInvocationFailure).phase).toBe(phase);
});

test.each([
  Object.freeze({ kind: 'attach_failed' }),
  Object.freeze({ kind: 'stdin_write_failed' }),
  Object.freeze({ kind: 'stdin_end_failed' }),
  Object.freeze({ kind: 'stdout_sink_failed' }),
  Object.freeze({ kind: 'stderr_sink_failed' }),
  Object.freeze({ kind: 'protocol_sink_failed' }),
  Object.freeze({ kind: 'duplex_operation_timeout', operation: 'attach' }),
  cleanupFailure,
  Object.freeze({ kind: 'internal' }),
] as const)('maps duplex primary %o to the running phase', (primary) => {
  const failure: NormalizedInvocationFailure = Object.freeze({
    kind: 'duplex',
    primary,
    code: 'revo.agent.process_failed',
  });
  expect(toAgentFault(failure).phase).toBe('running');
});

test.each<'revo.agent.scratch_cleanup_failed' | 'revo.agent.output_write_failed'>([
  'revo.agent.scratch_cleanup_failed',
  'revo.agent.output_write_failed',
])('maps a finalization failure with code %s', (code) => {
  const failure: NormalizedInvocationFailure = Object.freeze({ kind: 'finalization', code });
  const fault = toAgentFault(failure);
  expect(fault.code).toBe(code);
  expect(fault.details).toBeUndefined();
});

test('carries schema diagnostics into details for a result-schema failure', () => {
  const failure: NormalizedInvocationFailure = Object.freeze({
    kind: 'result_schema',
    code: 'revo.agent.result_schema_mismatch',
    diagnostics: Object.freeze({
      diagnostics: Object.freeze([
        Object.freeze({
          instancePath: '/value',
          instancePathTruncated: false,
          schemaPath: '#/properties/value',
          schemaPathTruncated: false,
          keyword: 'type',
          message: 'must be object',
        }),
      ]),
      truncated: false,
    }),
  });
  const fault = toAgentFault(failure);
  expect(fault.code).toBe('revo.agent.result_schema_mismatch');
  expect(fault.details).toEqual({
    schemaDiagnostics: {
      diagnostics: [
        {
          instancePath: '/value',
          instancePathTruncated: false,
          schemaPath: '#/properties/value',
          schemaPathTruncated: false,
          keyword: 'type',
          message: 'must be object',
        },
      ],
      truncated: false,
    },
  });
});

test('omits details for a result-schema failure with no diagnostics', () => {
  const failure: NormalizedInvocationFailure = Object.freeze({
    kind: 'result_schema',
    code: 'revo.agent.result_schema_mismatch',
  });
  expect(toAgentFault(failure).details).toBeUndefined();
});
