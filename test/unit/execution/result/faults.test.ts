import { expect, test } from 'vitest';

import {
  executablePreflightError,
  executionFailure,
  outputPreflightError,
  preacceptanceError,
} from '../../../../src/application/faults/agent-faults.js';

test('maps every executable preflight rejection to the public start fault', () => {
  for (const [reason, code] of [
    ['platform_unsupported', 'revo.agent.platform_unsupported'],
    ['executable_not_found', 'revo.agent.probe_spawn_failed'],
    ['executable_not_launchable', 'revo.agent.probe_spawn_failed'],
    ['probe_spawn_failed', 'revo.agent.probe_spawn_failed'],
    ['probe_timeout', 'revo.agent.probe_timeout'],
    ['probe_cleanup_failed', 'revo.agent.probe_spawn_failed'],
    ['probe_output_too_large', 'revo.agent.probe_output_too_large'],
    ['probe_process_failed', 'revo.agent.probe_process_failed'],
    ['probe_output_invalid', 'revo.agent.probe_output_invalid'],
  ] as const)
    expect(executablePreflightError(reason).fault).toMatchObject({
      code,
      phase: 'preflight',
      retryable: false,
    });
});

test('maps output admission and preacceptance outcomes to exact public faults', () => {
  expect(outputPreflightError('workspace_invalid').fault.code).toBe('revo.agent.workspace_invalid');
  expect(outputPreflightError('output_path_invalid').fault.code).toBe(
    'revo.agent.output_path_invalid',
  );
  expect(outputPreflightError('output_conflict').fault.code).toBe('revo.agent.output_conflict');
  expect(preacceptanceError({ status: 'cancelled' }, 'confirmed').fault.code).toBe(
    'revo.agent.cancelled',
  );
  expect(preacceptanceError({ status: 'timed_out' }, 'confirmed').fault.code).toBe(
    'revo.agent.timeout',
  );
  expect(preacceptanceError({ status: 'failed' }, 'confirmed').fault.code).toBe(
    'revo.agent.protocol_failed',
  );
  expect(preacceptanceError({ status: 'failed' }, 'uncertain').fault.code).toBe(
    'revo.agent.process_cleanup_failed',
  );
});

test('normalizes terminal result failures by their reader-visible phase', () => {
  expect(executionFailure('revo.agent.output_write_failed')).toMatchObject({ phase: 'finalizing' });
  for (const code of [
    'revo.agent.result_missing',
    'revo.agent.result_too_large',
    'revo.agent.result_invalid_json',
    'revo.agent.result_not_object',
    'revo.agent.result_schema_mismatch',
  ] as const)
    expect(executionFailure(code)).toMatchObject({ code, phase: 'collecting_result' });
  expect(executionFailure(undefined)).toMatchObject({
    code: 'revo.agent.protocol_failed',
    phase: 'execution',
  });
});
