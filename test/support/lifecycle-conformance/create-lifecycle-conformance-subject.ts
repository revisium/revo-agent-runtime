import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import type { InvocationExecutionPorts } from '../../../src/runtime/execution/index.js';
import { buildAgentDefinition } from '../definition/build-agent-definition.js';
import { FakeInvocationClock } from '../execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../execution/fake-output-port.js';
import { FreshAvailableExecutableProbePort } from '../probe/fresh-available-executable-probe-port.js';

const defaultResultSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
});
const definition = buildAgentDefinition();
const agent = Object.freeze({ id: definition.id, version: definition.version });

type LifecycleManager = ReturnType<typeof createInvocationLifecycleManager>;

export interface LifecycleConformanceSubject {
  readonly clock: FakeInvocationClock;
  readonly execution: FakeInvocationExecutionPort;
  readonly manager: LifecycleManager;
  readonly output: FakeInvocationOutputPort;
  createInput(
    invocationId: string,
    overrides?: Readonly<{
      metadata?: unknown;
      resultSchema?: unknown;
      wallClockTimeoutMs?: number;
    }>,
  ): Readonly<Record<string, unknown>>;
  start(input: unknown): ReturnType<LifecycleManager['start']>;
}

const createInput = (
  invocationId: string,
  overrides: Readonly<{
    metadata?: unknown;
    resultSchema?: unknown;
    wallClockTimeoutMs?: number;
  }> = Object.freeze({}),
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    agent,
    invocationId,
    prompt: 'Return JSON.',
    workspace: Object.freeze({ directory: '/workspace/project' }),
    parameters: Object.freeze({}),
    permissions: Object.freeze({}),
    result: Object.freeze({ schema: overrides.resultSchema ?? defaultResultSchema }),
    output: Object.freeze({ directory: '/outputs/invocation' }),
    ...(overrides.metadata === undefined ? {} : { metadata: overrides.metadata }),
    ...(overrides.wallClockTimeoutMs === undefined
      ? {}
      : {
          limits: Object.freeze({
            wallClockTimeoutMs: overrides.wallClockTimeoutMs,
            idleTimeoutMs: overrides.wallClockTimeoutMs,
          }),
        }),
  });

export const createLifecycleConformanceSubject = (
  options: Readonly<{ maxCompletedInvocations?: number }> = Object.freeze({}),
): LifecycleConformanceSubject => {
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const managerOptions = Object.freeze({
    definitions: Object.freeze([definition]),
    ...(options.maxCompletedInvocations === undefined
      ? {}
      : { limits: Object.freeze({ maxCompletedInvocations: options.maxCompletedInvocations }) }),
  });
  const ports: InvocationExecutionPorts &
    Readonly<{ executableProbe: FreshAvailableExecutableProbePort }> = Object.freeze({
    execution,
    clock,
    output,
    outputClaim: new FakeOutputClaimPort('created'),
    executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
    workspace: {
      admit: async () =>
        Object.freeze({ status: 'admitted' as const, directory: '/workspace/project' }),
    },
  });
  const manager = createInvocationLifecycleManager(managerOptions, ports);

  return Object.freeze({
    clock,
    execution,
    manager,
    output,
    createInput,
    start: (input: unknown) => manager.start(input),
  });
};
