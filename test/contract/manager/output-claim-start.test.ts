import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import { NodePosixOutputAdmissionPort } from '../../../src/platform/process/index.js';
import type {
  InvocationExecutionPorts,
  OutputClaimExclusiveCreatePort,
  OutputClaimExclusiveCreateRequest,
  OutputClaimPlatformResult,
} from '../../../src/runtime/execution/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../support/execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../../support/execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../../support/execution/fake-output-port.js';
import { FreshAvailableExecutableProbePort } from '../../support/probe/fresh-available-executable-probe-port.js';

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

const createTemporaryRoot = async (): Promise<string> => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'revo-output-claim-start-'));
  return temporaryRoot;
};

const definition = buildAgentDefinition();
const agent = Object.freeze({ id: definition.id, version: definition.version });
const resultSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const waitForClaimDeadlineRegistration = async (
  clock: FakeInvocationClock,
  remainingAttempts: number,
): Promise<void> => {
  if (clock.pendingActionCount() > 0 || remainingAttempts === 0) return;
  await flush();
  return waitForClaimDeadlineRegistration(clock, remainingAttempts - 1);
};

const advanceClaimDeadline = async (clock: FakeInvocationClock): Promise<void> => {
  await waitForClaimDeadlineRegistration(clock, 10);
  expect(clock.pendingActionCount()).toBeGreaterThan(0);
  clock.advanceBy(10_000);
};

const createStartInput = (
  overrides: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    invocationId: 'claim-start',
    agent,
    prompt: 'Return JSON.',
    workspace: Object.freeze({ directory: '/workspace/project' }),
    parameters: Object.freeze({}),
    permissions: Object.freeze({}),
    result: Object.freeze({ schema: resultSchema }),
    output: Object.freeze({ directory: '/outputs/invocation' }),
    ...overrides,
  });

class OrderedClaimPort implements OutputClaimExclusiveCreatePort {
  constructor(
    private readonly delegate: FakeOutputClaimPort,
    private readonly order: string[],
  ) {}

  createExclusiveOutputDirectory(
    request: OutputClaimExclusiveCreateRequest,
  ): Promise<OutputClaimPlatformResult> {
    this.order.push('claim');
    return this.delegate.createExclusiveOutputDirectory(request);
  }
}

const createSubject = (
  outputClaim: OutputClaimExclusiveCreatePort = new FakeOutputClaimPort('created'),
) => {
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const ports = {
    execution,
    clock,
    output,
    outputClaim,
    executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
    workspace: {
      admit: async () =>
        Object.freeze({ status: 'admitted' as const, directory: '/workspace/project' }),
    },
  };
  return Object.freeze({
    clock,
    execution,
    manager: createInvocationLifecycleManager({ definitions: [definition] }, ports),
    output,
    ports,
  });
};

test('claims output before preparing the admitted output plan', async () => {
  const order: string[] = [];
  const claim = new FakeOutputClaimPort();
  claim.enqueue('created');
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueuePrepare();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const ports: InvocationExecutionPorts & {
    readonly executableProbe: FreshAvailableExecutableProbePort;
  } = {
    execution,
    clock,
    output: {
      admit: (request) => output.admit(request),
      prepare: async () => {
        order.push('prepare');
        await output.prepare();
      },
      recordTerminalResult: (outcome) => output.recordTerminalResult(outcome),
      recordEvent: () => output.recordEvent(),
    },
    outputClaim: new OrderedClaimPort(claim, order),
    executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
    workspace: {
      admit: async () =>
        Object.freeze({ status: 'admitted' as const, directory: '/workspace/project' }),
    },
  };
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);

  await expect(manager.start(createStartInput({ invocationId: 'created' }))).resolves.toMatchObject(
    { status: 'accepted' },
  );
  expect(order).toEqual(['claim', 'prepare']);
  expect(claim.requests()).toHaveLength(1);
  expect(claim.requests()[0]).toMatchObject({
    invocationId: 'created',
    outputDirectory: '/outputs/invocation',
  });
});

test.each(['leaf-exists', 'create-failed'] as const)(
  'rejects %s claim without preparing output or retaining the id',
  async (operation) => {
    const claim = new FakeOutputClaimPort();
    claim.enqueue(operation);
    const { manager, output } = createSubject(claim);

    await expect(
      manager.start(createStartInput({ invocationId: `rejected-${operation}` })),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'output_claim_failed',
    });
    expect(output.calls()).not.toContainEqual({ type: 'prepare' });
    expect(manager.getResult(`rejected-${operation}`)).toEqual({ state: 'unknown' });
    await expect(
      manager.start(createStartInput({ invocationId: `rejected-${operation}` })),
    ).resolves.not.toEqual({ status: 'rejected', reason: 'duplicate_invocation' });
  },
);

test('converts a predispatch adapter throw into output claim failure', async () => {
  const claim = new FakeOutputClaimPort();
  claim.enqueue('throw-before-dispatch');
  const { manager } = createSubject(claim);

  await expect(manager.start(createStartInput({ invocationId: 'throw-before' }))).resolves.toEqual({
    status: 'rejected',
    reason: 'output_claim_failed',
  });
});

test.each(['pending', 'throw-after-dispatch'] as const)(
  'quarantines invocation id after uncertain %s claim',
  async (operation) => {
    const claim = new FakeOutputClaimPort();
    claim.enqueue(operation);
    const { manager, clock, output } = createSubject(claim);

    const started = manager.start(createStartInput({ invocationId: `uncertain-${operation}` }));
    if (operation === 'pending') {
      await advanceClaimDeadline(clock);
    }

    await expect(started).resolves.toEqual({
      status: 'rejected',
      reason: 'output_claim_uncertain',
    });
    expect(output.calls()).not.toContainEqual({ type: 'prepare' });
    expect(manager.getResult(`uncertain-${operation}`)).toEqual({ state: 'unknown' });
    await expect(manager.waitForResult(`uncertain-${operation}`)).resolves.toEqual({
      state: 'unknown',
    });
    await expect(
      manager.start(createStartInput({ invocationId: `uncertain-${operation}` })),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'duplicate_invocation',
    });
  },
);

test('late claim reconciliation after timeout does not release the quarantined id', async () => {
  const claim = new FakeOutputClaimPort();
  claim.enqueue('pending');
  const { manager, clock } = createSubject(claim);

  const started = manager.start(createStartInput({ invocationId: 'late-created' }));
  await advanceClaimDeadline(clock);
  await expect(started).resolves.toEqual({
    status: 'rejected',
    reason: 'output_claim_uncertain',
  });

  claim.settlePendingCreated(1);
  await flush();
  await expect(manager.start(createStartInput({ invocationId: 'late-created' }))).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
});

test('quarantined output path prevents a second claim for the same admitted path', async () => {
  const claim = new FakeOutputClaimPort();
  claim.enqueue('pending');
  const { manager, clock } = createSubject(claim);

  const first = manager.start(
    createStartInput({ invocationId: 'path-owner', output: { directory: '/out/x' } }),
  );
  await advanceClaimDeadline(clock);
  await expect(first).resolves.toEqual({
    status: 'rejected',
    reason: 'output_claim_uncertain',
  });
  await expect(
    manager.start(
      createStartInput({ invocationId: 'path-contender', output: { directory: '/out/x' } }),
    ),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'output_claim_failed',
  });
  expect(claim.requests()).toHaveLength(1);
});

test('trailing-slash output admission rejects before a second claim attempt is created', async () => {
  const root = await createTemporaryRoot();
  const outputDirectory = join(root, 'claimed-output');
  const claim = new FakeOutputClaimPort();
  claim.enqueue('throw-after-dispatch');
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const admission = new NodePosixOutputAdmissionPort();
  const ports: InvocationExecutionPorts & {
    readonly executableProbe: FreshAvailableExecutableProbePort;
  } = {
    execution,
    clock,
    output: {
      admit: async (request) => {
        await output.admit(request);
        return await admission.admit(request);
      },
      prepare: () => output.prepare(),
      recordTerminalResult: (outcome) => output.recordTerminalResult(outcome),
      recordEvent: () => output.recordEvent(),
    },
    outputClaim: claim,
    executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
    workspace: {
      admit: async () =>
        Object.freeze({ status: 'admitted' as const, directory: '/workspace/project' }),
    },
  };
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);

  const first = manager.start(
    createStartInput({ invocationId: 'slash-owner', output: { directory: outputDirectory } }),
  );
  await expect(first).resolves.toEqual({
    status: 'rejected',
    reason: 'output_claim_uncertain',
  });
  await expect(
    manager.start(
      createStartInput({
        invocationId: 'slash-contender',
        output: { directory: `${outputDirectory}/` },
      }),
    ),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'preflight_failed',
  });
  expect(output.calls().filter((call) => call.type === 'admit')).toEqual([
    {
      type: 'admit',
      request: {
        invocationId: 'slash-owner',
        outputDirectory,
        needsPromptFile: false,
        needsResultSchemaFile: false,
      },
    },
    {
      type: 'admit',
      request: {
        invocationId: 'slash-contender',
        outputDirectory: `${outputDirectory}/`,
        needsPromptFile: false,
        needsResultSchemaFile: false,
      },
    },
  ]);
  expect(claim.requests()).toHaveLength(1);
});

test('fails closed when the output claim port is missing', async () => {
  const subject = createSubject();
  Reflect.deleteProperty(subject.ports, 'outputClaim');

  await expect(
    subject.manager.start(createStartInput({ invocationId: 'missing-claim-port' })),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'output_claim_failed',
  });
});

test('records exactly one claim request for one start call', async () => {
  const claim = new FakeOutputClaimPort('created');
  const { manager, output, execution } = createSubject(claim);
  output.enqueuePrepare();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');

  expect(claim.requests()).toHaveLength(0);
  await expect(
    manager.start(createStartInput({ invocationId: 'adjacency-witness' })),
  ).resolves.toMatchObject({ status: 'accepted' });
  expect(claim.requests()).toHaveLength(1);
});
