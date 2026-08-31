import { expect, test } from 'vitest';

import { buildInvocationResult } from '../../../../src/application/result/invocation-result.js';
import type { AgentExecutionPin, StartAgentInvocation } from '../../../../src/contracts/manager.js';
import type { ExecutionEvidence } from '../../../../src/execution/invocation/executor.js';

const request: StartAgentInvocation = {
  agent: { id: 'codex', version: '1.0.0' },
  invocationId: 'result-fixture',
  output: { directory: '/fixture/output' },
  parameters: {},
  permissions: {},
  prompt: 'Return a result.',
  result: { schema: { type: 'object' } },
  workspace: { directory: '/fixture/workspace' },
};

const pin: AgentExecutionPin = {
  agentId: 'codex',
  agentVersion: '1.0.0',
  definitionDigest: 'sha256:fixture',
};

const evidence: ExecutionEvidence = {
  launch: { executable: '/fixture/agent', reportedVersion: '1.0.0' },
  processExit: { exitCode: 0, signal: null },
};

test('rejects timing that cannot describe a real invocation duration', () => {
  expect(() =>
    buildInvocationResult(
      request,
      pin,
      { status: 'succeeded', value: { answer: 'ignored' } },
      evidence,
      { acceptedAt: 'not-a-time', finishedAt: '2026-08-30T00:00:01.000Z' },
    ),
  ).toThrow('Invalid invocation timing.');
});

test('does not claim unpublished result or raw response files after publication failure', () => {
  expect(
    buildInvocationResult(
      request,
      pin,
      {
        code: 'revo.agent.result_schema_mismatch',
        status: 'failed',
      },
      evidence,
      { acceptedAt: '2026-08-30T00:00:00.000Z', finishedAt: '2026-08-30T00:00:01.000Z' },
      { committed: false, rawPublished: false },
    ),
  ).toMatchObject({
    error: { code: 'revo.agent.result_schema_mismatch' },
    files: { directory: '/fixture/output', events: 'events.ndjson' },
    status: 'failed',
  });
});
