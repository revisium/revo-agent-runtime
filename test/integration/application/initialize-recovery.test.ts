import { expect, test } from 'vitest';

import {
  createInvocationLifecycleManager,
  createNativeProcessExecutionPort,
} from '../../../src/application/manager/index.js';
import { validateManagerOptions } from '../../../src/runtime/definition/index.js';
import {
  ExecutionBindingToken,
  InvocationInputSnapshot,
  PreparedLaunch,
  type InvocationExecutionPorts,
  type ProcessOutputSink,
  type RedactionChannel,
  type ResultSchemaValidator,
} from '../../../src/runtime/execution/index.js';
import type { ActiveInvocationSnapshot } from '../../../src/runtime/spec/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FakeOutputClaimPort } from '../../support/execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../../support/execution/fake-output-port.js';
import { FakeOutputPreparationPort } from '../../support/execution/fake-output-preparation-port.js';
import { FreshAvailableExecutableProbePort } from '../../support/probe/fresh-available-executable-probe-port.js';

const resultSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
});
const acceptObject: ResultSchemaValidator = Object.freeze({ validate: () => undefined });
const definition = buildAgentDefinition({
  launch: {
    command: process.execPath,
    args: [
      { kind: 'literal', value: '-e' },
      { kind: 'literal', value: 'setInterval(() => undefined, 1000)' },
      { kind: 'prompt' },
      { kind: 'result-schema' },
    ],
    versionProbe: {
      args: ['-e', "console.log('agent 1.0.0')"],
      stream: 'stdout',
      prefix: 'agent ',
      timeoutMs: 1_000,
    },
  },
});
const validatedDefinition = validateManagerOptions({
  activeStateSink: { save: async () => undefined, remove: async () => undefined },
  definitions: [definition],
}).definitions[0];
if (validatedDefinition === undefined) throw new Error('Expected validated definition.');

const snapshot = (invocationId: string): InvocationInputSnapshot => {
  const value = InvocationInputSnapshot.create({
    invocationId,
    agent: { id: definition.id, version: definition.version },
    prompt: 'Return JSON.',
    workspace: { directory: process.cwd() },
    parameters: {},
    permissions: {},
    result: { schema: resultSchema },
    output: { directory: `/tmp/${invocationId}` },
  });
  if (value === undefined) throw new Error('Expected invocation snapshot.');
  return value;
};

const outputSink = (): ProcessOutputSink =>
  Object.freeze({
    write: async (): Promise<void> => undefined,
    end: async (): Promise<void> => undefined,
  });
const redaction = (): RedactionChannel =>
  Object.freeze({
    feed: (chunk: Uint8Array): Uint8Array => new Uint8Array(chunk),
    flush: (): Uint8Array => new Uint8Array(),
    dispose: (): void => undefined,
  });
const resources = (): NonNullable<
  Parameters<InvocationExecutionPorts['execution']['spawnAndIdentify']>[2]
> =>
  Object.freeze({
    attestations: Object.freeze([]),
    frontEnds: Object.freeze({
      stdout: redaction(),
      stderr: redaction(),
      rawResponse: redaction(),
    }),
    evidenceSinks: Object.freeze({ stdout: outputSink(), stderr: outputSink() }),
  });
const binding = Object.freeze({
  protocolDriverId: 'native/stdio-v1' as const,
  resultParserId: 'codex-jsonl/v1' as const,
  permissionStrategyId: 'codex-cli/v1' as const,
  delivery: Object.freeze({
    prompt: 'argument' as const,
    resultSchema: 'argument' as const,
    result: 'stdout' as const,
  }),
});
const preparedLaunch = (invocationId: string): PreparedLaunch => {
  const pin = {
    agentId: definition.id,
    agentVersion: definition.version,
    definitionDigest: validatedDefinition.definitionDigest,
  };
  const value = PreparedLaunch.create({
    pin,
    executable: process.execPath,
    reportedVersion: '1.0.0',
    limits: snapshot(invocationId).limits,
    effectiveParameters: {},
    effectivePermissions: {},
    childEnvironment: {},
    childEnvironmentSecretValues: [],
    secretValues: [],
    resultSchemaValidator: acceptObject,
    outputResourcePlan: {
      invocationId,
      outputDirectory: `/tmp/${invocationId}`,
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [
      { kind: 'arguments', arguments: ['-e', 'setInterval(() => undefined, 1000)'] },
    ],
    preparedPayloads: { arguments: ['-e', 'setInterval(() => undefined, 1000)'], files: [] },
    binding,
    bindingToken: ExecutionBindingToken.create({ ...pin, ...binding }),
  });
  if (value === undefined) throw new Error('Expected prepared launch.');
  return value;
};

const spawnRecovered = async (
  execution: InvocationExecutionPorts['execution'],
  invocationId: string,
) => {
  const result = await execution.spawnAndIdentify(
    snapshot(invocationId),
    preparedLaunch(invocationId),
    resources(),
  );
  if (result.status !== 'identified')
    throw new Error(`Expected identified process, got ${result.reason}.`);
  return result;
};

const recoveryRow = (
  invocationId: string,
  pid: number,
  fingerprint: string,
): ActiveInvocationSnapshot =>
  Object.freeze({
    invocationId,
    pin: Object.freeze({
      agentId: definition.id,
      agentVersion: definition.version,
      definitionDigest: validatedDefinition.definitionDigest,
    }),
    state: 'running' as const,
    process: Object.freeze({
      pid,
      processGroupId: pid,
      fingerprint,
      startedAt: new Date().toISOString(),
    }),
  });

const createRecoveryManager = (
  execution: InvocationExecutionPorts['execution'],
  calls: string[],
  runningPids: number[] = [],
) => {
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  return createInvocationLifecycleManager(
    {
      activeStateSink: {
        save: async (activeSnapshot: ActiveInvocationSnapshot) => {
          if (activeSnapshot.state === 'running') runningPids.push(activeSnapshot.process.pid);
        },
        remove: async (invocationId: string) => {
          calls.push(invocationId);
        },
      },
      definitions: [definition],
    },
    () => ({
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output,
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: new FreshAvailableExecutableProbePort(process.execPath, '1.0.0'),
      workspace: {
        admit: async (directory: string) => ({ status: 'admitted' as const, directory }),
      },
    }),
  );
};

test.runIf(process.platform === 'linux')(
  'reconciles a real matching recovered process and removes its row',
  async () => {
    const execution = createNativeProcessExecutionPort();
    const identified = await spawnRecovered(execution, 'recovery-golden');
    const calls: string[] = [];
    const manager = createRecoveryManager(execution, calls);

    await manager.initialize([
      recoveryRow('recovery-golden', identified.identity.pid, identified.identity.fingerprint),
    ]);

    expect(calls).toEqual(['recovery-golden']);
    expect(() => process.kill(identified.identity.pid, 0)).toThrow();
  },
);

test.runIf(process.platform === 'linux')(
  'preserves a live process on recovered identity mismatch',
  async () => {
    const execution = createNativeProcessExecutionPort();
    const identified = await spawnRecovered(execution, 'recovery-mismatch');
    const calls: string[] = [];
    const manager = createRecoveryManager(execution, calls);

    await expect(
      manager.initialize([
        recoveryRow('recovery-mismatch', identified.identity.pid, 'sha256:not-this-process'),
      ]),
    ).rejects.toMatchObject({
      fault: { details: { failures: [{ category: 'identity_conflict' }] } },
    });
    expect(calls).toEqual([]);
    expect(() => process.kill(identified.identity.pid, 0)).not.toThrow();
    await expect(identified.killAndReap()).resolves.toBeUndefined();
  },
);

test.runIf(process.platform === 'linux')(
  'reconciles an absent recovered pid without signaling',
  async () => {
    const execution = createNativeProcessExecutionPort();
    const calls: string[] = [];
    const manager = createRecoveryManager(execution, calls);

    await manager.initialize([recoveryRow('recovery-absent', 999_999, 'sha256:missing')]);

    expect(calls).toEqual(['recovery-absent']);
  },
);

test.runIf(process.platform === 'linux')(
  'continues with ordinary start and shutdown after successful non-empty recovery',
  async () => {
    const execution = createNativeProcessExecutionPort();
    const identified = await spawnRecovered(execution, 'recovery-cross-phase');
    const calls: string[] = [];
    const runningPids: number[] = [];
    const manager = createRecoveryManager(execution, calls, runningPids);

    await manager.initialize([
      recoveryRow('recovery-cross-phase', identified.identity.pid, identified.identity.fingerprint),
    ]);
    expect(() => process.kill(identified.identity.pid, 0)).toThrow();

    const started = await manager.start({
      invocationId: 'ordinary-after-recovery',
      agent: { id: definition.id, version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: process.cwd() },
      parameters: {},
      permissions: {},
      result: { schema: resultSchema },
      output: { directory: '/tmp/ordinary-after-recovery' },
    });
    expect(started.status).toBe('accepted');
    if (started.status !== 'accepted') throw new Error('Expected accepted invocation.');

    await expect(manager.shutdown('done')).resolves.toBeUndefined();
    await expect(started.handle.result()).resolves.toMatchObject({ status: 'cancelled' });
    const runningPid = runningPids[0];
    if (runningPid === undefined) throw new Error('Expected ordinary running process.');
    expect(() => process.kill(runningPid, 0)).toThrow();
    expect(calls).toEqual(['recovery-cross-phase', 'ordinary-after-recovery']);
  },
);
