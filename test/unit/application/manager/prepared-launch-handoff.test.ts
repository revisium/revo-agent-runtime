import { expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ probeExecutable: vi.fn() }));

vi.mock('../../../../src/runtime/probe/index.js', () => ({
  probeExecutable: mocks.probeExecutable,
}));

import { createInvocationLifecycleManager } from '../../../../src/application/manager/index.js';
import { validateManagerOptions } from '../../../../src/runtime/definition/index.js';
import { buildAgentDefinition } from '../../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../../support/execution/fake-execution-port.js';
import { FakeInvocationOutputPort } from '../../../support/execution/fake-output-port.js';
import { FakeExecutableProbePort } from '../../../support/probe/fake-executable-probe-port.js';

const resultSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
});

test('rejects mismatched or incomplete available probe evidence before output and execution', async () => {
  const definition = buildAgentDefinition();
  const [validatedDefinition] = validateManagerOptions({ definitions: [definition] }).definitions;
  if (validatedDefinition === undefined) throw new Error('Expected validated definition');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
    },
  );
  const exactAgent = Object.freeze({ id: definition.id, version: definition.version });
  const exactEvidence = {
    status: 'available' as const,
    agent: exactAgent,
    definitionDigest: validatedDefinition.definitionDigest,
    executable: '/resolved/fixture-agent',
    reportedVersion: '1.0.0',
  };
  mocks.probeExecutable
    .mockResolvedValueOnce({ ...exactEvidence, agent: { ...exactAgent, id: 'other-agent' } })
    .mockResolvedValueOnce({ ...exactEvidence, agent: { ...exactAgent, version: '2.0.0' } })
    .mockResolvedValueOnce({ ...exactEvidence, definitionDigest: 'other-digest' })
    .mockResolvedValueOnce({
      status: 'available',
      agent: exactAgent,
      definitionDigest: validatedDefinition.definitionDigest,
      executable: '/resolved/fixture-agent',
    });

  const outcomes = await Promise.all(
    [
      'mismatched-agent-id',
      'mismatched-agent-version',
      'mismatched-definition-digest',
      'missing-reported-version',
    ].map((invocationId) => manager.start({ invocationId, agent: exactAgent, resultSchema })),
  );
  expect(outcomes).toEqual([
    { status: 'rejected', reason: 'preflight_failed' },
    { status: 'rejected', reason: 'preflight_failed' },
    { status: 'rejected', reason: 'preflight_failed' },
    { status: 'rejected', reason: 'preflight_failed' },
  ]);

  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});
