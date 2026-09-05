import { describe, expect, it } from 'vitest';

import { validateAgentDefinition } from '../../../../../../src/definition/index.js';
import { createProviderOpeningInterpreters } from '../../../../../../src/execution/session/interpreter/provider/opening.js';
import { createSessionInterpreterResources } from '../../../../../../src/execution/session/interpreter/provider/opening/resources.js';
import type { SessionRuntimeIdentitySource } from '../../../../../../src/execution/session/runtime/primitives/identity.js';
import { agentDefinition } from '../../../../../support/builders/agent-definition.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';
import { createControllableSessionProtocolDriver } from '../../../../../support/session/fakes/protocol/driver.js';
import { recordingSessionEffectOutput } from '../../../../../support/session/interpreter/output.js';
import { flushMicrotasks } from '../../../../../support/session/runtime/scheduling/async-steps.js';

const clock = {
  now: () => ({ iso: '2026-09-05T00:00:01.000Z', milliseconds: 1_000 }),
};
const capabilities = {
  cancellation: { prompt: true, session: true },
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;

const identities = (...values: string[]): SessionRuntimeIdentitySource => ({
  next: () => {
    const value = values.shift();
    if (value === undefined) throw new Error('Missing test identity');
    return value;
  },
});

const protocolInteraction = {
  request: {
    action: { kind: 'edit' as const, title: 'Edit source' },
    kind: 'permission' as const,
    options: [{ kind: 'allow_once' as const, label: 'Allow', optionId: 'allow' }],
    requestId: 'permission-1',
  },
  type: 'interaction.requested' as const,
};

const runOpening = async (mode: 'fresh' | 'resume') => {
  const driver = createControllableSessionProtocolDriver({
    openings: [
      {
        kind: mode,
        outcome: { capabilities, status: 'opened' },
        steps: mode === 'fresh' ? [{ type: 'update', value: protocolInteraction }] : [],
      },
    ],
  });
  const resources = createSessionInterpreterResources();
  const definition = validateAgentDefinition(agentDefinition({ version: '1' })).definition;
  const process = {
    completion: new Promise<never>(() => undefined),
    identity: {
      fingerprint: 'process',
      pid: 42,
      processGroupId: 42,
      startedAt: '2026-09-05T00:00:00.500Z',
    },
    terminateAndReap: async () => ({
      exit: { exitCode: 0, signal: null },
      status: 'confirmed' as const,
    }),
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    },
  };
  const output = recordingSessionEffectOutput();
  const handlers = createProviderOpeningInterpreters({
    clock,
    driver,
    identities: identities('preparation-1', 'process-1', 'provider-1'),
    preparer: {
      prepare: async () => ({
        status: 'prepared',
        value: {
          definition,
          inputs: {
            parameters: { model: 'effective-model' },
            permissions: { write: false },
          },
          launch: { args: [], command: 'agent', cwd: '/workspace' },
          output: {
            publish: async () => ({
              files: {
                directory: '/output',
                manifest: 'session.json',
                stderr: 'stderr.log',
                stdout: 'stdout.log',
              },
              state: 'published',
            }),
          },
        },
      }),
    },
    resources,
    spawner: {
      start: async (launch) => {
        launch.onStdout?.(new TextEncoder().encode('token=secret'));
        launch.onStderr?.(new TextEncoder().encode('warning'));
        return process;
      },
    },
  });
  const [prepare, start, connect] = handlers;
  if (prepare === undefined || start === undefined || connect === undefined)
    throw new Error('Missing opening interpreter');
  const opening = {
    ...sessionOpeningCommand(mode).opening,
    environment: { secrets: ['secret'], values: { token: 'secret' } },
  };
  prepare.execute(
    {
      correlation: { effectId: 'prepare-effect', epoch: 1, sessionId: 'session_01' },
      opening,
      timeoutMs: 100,
      type: 'opening.prepare',
    },
    output.output,
  );
  await flushMicrotasks(8);
  start.execute(
    {
      correlation: { effectId: 'process-effect', epoch: 1, sessionId: 'session_01' },
      preparationId: 'preparation-1',
      timeoutMs: 100,
      type: 'process.start',
    },
    output.output,
  );
  await flushMicrotasks(8);
  connect.execute(
    {
      correlation: { effectId: 'provider-effect', epoch: 1, sessionId: 'session_01' },
      preparationId: 'preparation-1',
      processResourceId: 'process-1',
      timeoutMs: 100,
      type: 'provider.open',
    },
    output.output,
  );
  await flushMicrotasks(16);
  return { driver, output, resources };
};

describe('provider opening interpreters', () => {
  it('prepares output, starts a process, opens fresh and publishes an opening interaction', async () => {
    const result = await runOpening('fresh');

    expect(result.output.outcomes.map(({ type }) => type)).toEqual([
      'opening.preparation.succeeded',
      'process.started',
      'provider.opened',
    ]);
    expect(result.output.updates).toEqual([
      expect.objectContaining({
        providerResourceId: 'provider-1',
        scope: { kind: 'opening' },
        type: 'provider.interaction_requested',
      }),
    ]);
    expect(result.driver.calls[0]).toMatchObject({
      request: {
        parameters: { model: 'effective-model' },
        permissions: { write: false },
      },
      type: 'open.fresh',
    });
    const collected = result.resources.preparations.get('preparation-1')?.output.finalize();
    expect(new TextDecoder().decode(collected?.stdout)).toBe('token=[REDACTED]');
    expect(new TextDecoder().decode(collected?.stderr)).toBe('warning');
  });

  it('uses only the native continuation when resuming', async () => {
    const result = await runOpening('resume');

    expect(result.driver.calls[0]).toMatchObject({
      request: {
        continuation: { data: { providerSessionId: 'provider_01' }, format: 'acp/v1' },
        kind: 'resume',
      },
      type: 'open.resume',
    });
  });
});
