import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import type { AgentDefinitionInput } from '../../../src/runtime/spec/index.js';
import { createTestActiveStateSink } from '../definition/build-agent-definition.js';
import { FakeInvocationClock } from '../execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../execution/fake-output-port.js';
import { FakeOutputPreparationPort } from '../execution/fake-output-preparation-port.js';
import { FakeExecutableProbePort } from '../probe/fake-executable-probe-port.js';

export const createProbeCapableManager = (definitions: readonly AgentDefinitionInput[]) => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  const manager = createInvocationLifecycleManager(
    { activeStateSink: createTestActiveStateSink(), definitions },
    {
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      execution: new FakeInvocationExecutionPort(),
      executableProbe: port,
      output: new FakeInvocationOutputPort(),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );
  return Object.freeze({ manager, port });
};

export const createInitializedProbeCapableManager = async (
  definitions: readonly AgentDefinitionInput[],
) => {
  const subject = createProbeCapableManager(definitions);
  await subject.manager.initialize([]);
  return subject;
};
