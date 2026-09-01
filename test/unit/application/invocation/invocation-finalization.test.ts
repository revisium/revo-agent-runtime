import { expect, test } from 'vitest';

import { finalizeInvocation } from '../../../../src/application/invocation/finalization.js';
import type { EffectiveLimits } from '../../../../src/application/manager/limits.js';
import type {
  AgentEvent,
  AgentExecutionPin,
  StartAgentInvocation,
} from '../../../../src/contracts/manager.js';
import type { InvocationExecution } from '../../../../src/execution/invocation/executor.js';
import { ClaimedInvocationOutput } from '../../../../src/execution/output/claim.js';
import { RawResponseEvidence } from '../../../../src/execution/result/raw-response.js';

const request: StartAgentInvocation = {
  agent: { id: 'codex', version: '1.0.0' },
  invocationId: 'publication-failure',
  output: { directory: '/fixture/output' },
  parameters: {},
  permissions: {},
  prompt: 'Return.',
  result: { schema: { type: 'object' } },
  workspace: { directory: '/fixture/workspace' },
};
const pin: AgentExecutionPin = {
  agentId: 'codex',
  agentVersion: '1.0.0',
  definitionDigest: 'sha256:fixture',
};
const finished: AgentEvent = {
  schemaVersion: 'agent-event/v1',
  invocationId: request.invocationId,
  pin,
  sequence: 2,
  timestamp: '2026-08-30T00:00:01.000Z',
  type: 'invocation.finished',
};
const limits: EffectiveLimits = {
  activeStateOperationTimeoutMs: 100,
  idleTimeoutMs: 1000,
  initializationTimeoutMs: 1000,
  maxCompletedInvocations: 1,
  maxEventBytes: 1024,
  maxEventsFileBytes: 1024,
  maxRawResponseBytes: 65536,
  maxStderrBytes: 65536,
  maxStdoutBytes: 65536,
  wallClockTimeoutMs: 1000,
};
const execution: InvocationExecution = {
  admission: new Promise(() => undefined),
  completion: new Promise(() => undefined),
  drainage: new Promise(() => undefined),
  activate: () => undefined,
  cancel: () => false,
  evidence: () => ({
    launch: { executable: '/fixture/agent', reportedVersion: '1.0.0' },
    processExit: { exitCode: 1, signal: null },
  }),
};

const finalizationRequest = (
  overrides: Partial<Parameters<typeof finalizeInvocation>[0]> = {},
) => ({
  activeState: { removeTerminal: async () => true },
  execution,
  finished,
  limits,
  outcome: { status: 'succeeded' as const, value: {} },
  output: ClaimedInvocationOutput.create('/fixture/output'),
  outputPublisher: { publish: async () => ({ files: [], status: 'failed' as const }) },
  pin,
  priorEvents: [],
  request,
  timing: { acceptedAt: '2026-08-30T00:00:00.000Z' },
  ...overrides,
});

test('turns a failed output publication into a non-committed finalizing result', async () => {
  const result = await finalizeInvocation(
    finalizationRequest({
      outcome: {
        status: 'succeeded',
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        value: {},
      },
    }),
  );
  expect(result).toMatchObject({
    error: { code: 'revo.agent.output_write_failed', phase: 'finalizing' },
    files: { directory: '/fixture/output' },
    status: 'failed',
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
  });
  expect(result?.files).not.toHaveProperty('result');

  const withoutUsage = await finalizeInvocation(finalizationRequest());
  expect(withoutUsage).not.toHaveProperty('usage');
});

test('withholds finalization when execution evidence or durable state removal is unavailable', async () => {
  const withoutEvidence: InvocationExecution = { ...execution, evidence: () => undefined };
  await expect(
    finalizeInvocation(finalizationRequest({ execution: withoutEvidence })),
  ).resolves.toBeUndefined();
  await expect(
    finalizeInvocation(finalizationRequest({ activeState: { removeTerminal: async () => false } })),
  ).resolves.toBeUndefined();
});

test('publishes raw terminal evidence only for failed outcomes and preserves a successful result', async () => {
  const evidence = new RawResponseEvidence({
    byteLength: 2,
    bytes: new TextEncoder().encode('{}'),
    observations: 1,
    previewBytes: 32,
  });
  let rawResponse: Uint8Array | undefined;
  const result = await finalizeInvocation(
    finalizationRequest({
      outcome: { code: 'revo.agent.result_missing', evidence, status: 'failed' },
      outputPublisher: {
        publish: async (_output, input) => {
          rawResponse = input.rawResponse;
          return { files: [], status: 'published' };
        },
      },
    }),
  );
  expect(rawResponse).toEqual(new TextEncoder().encode('{}'));
  expect(result).toMatchObject({ files: { rawFinalResponse: 'raw-final-response.txt' } });
});
