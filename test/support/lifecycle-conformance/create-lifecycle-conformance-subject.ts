import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import type { InvocationExecutionPorts } from '../../../src/runtime/execution/index.js';
import { FakeInvocationClock } from '../execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../execution/fake-execution-port.js';
import { FakeInvocationOutputPort } from '../execution/fake-output-port.js';

const defaultResultSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
});

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
    invocationId,
    resultSchema: overrides.resultSchema ?? defaultResultSchema,
    ...(overrides.metadata === undefined ? {} : { metadata: overrides.metadata }),
    ...(overrides.wallClockTimeoutMs === undefined
      ? {}
      : { wallClockTimeoutMs: overrides.wallClockTimeoutMs }),
  });

export const createLifecycleConformanceSubject = (
  options: Readonly<{ maxCompletedInvocations?: number }> = Object.freeze({}),
): LifecycleConformanceSubject => {
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const managerOptions = Object.freeze({
    definitions: Object.freeze([]),
    ...(options.maxCompletedInvocations === undefined
      ? {}
      : { limits: Object.freeze({ maxCompletedInvocations: options.maxCompletedInvocations }) }),
  });
  const ports: InvocationExecutionPorts = Object.freeze({ execution, clock, output });
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
