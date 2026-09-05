import { createHash } from 'node:crypto';

import { createManagedAgentSessions } from '../../../../src/application/session/management/managed-sessions.js';
import type { AgentDescriptor } from '../../../../src/contracts/manager.js';
import type { AgentSessionEvent, AgentSessions } from '../../../../src/contracts/session.js';
import { validateAgentDefinition } from '../../../../src/definition/index.js';
import { composeSessionInterpreters } from '../../../../src/execution/session/interpreter/composition/interpreters.js';
import { reduceSession } from '../../../../src/execution/session/kernel/reducer/reduce.js';
import { SessionActorFactory } from '../../../../src/execution/session/runtime/actor/factory.js';
import { SessionEffectDispatcher } from '../../../../src/execution/session/runtime/effects/dispatcher.js';
import type { SessionClock } from '../../../../src/execution/session/runtime/timing/clock.js';
import { agentDefinition } from '../../builders/agent-definition.js';
import {
  createControllableSessionProtocolDriver,
  type FakeSessionProtocolCall,
} from '../fakes/protocol/driver.js';

const capabilities = {
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;
const protocolCapabilities = {
  ...capabilities,
  cancellation: { prompt: true, session: true },
} as const;

export interface AgentSessionStoryOptions {
  readonly checkpoint: Readonly<Record<string, string>>;
  readonly replies: readonly string[];
}

export interface AgentSessionStory {
  readonly sessions: AgentSessions;
  open(sessionId: string): ReturnType<AgentSessions['open']>;
  eventTypes(): readonly AgentSessionEvent['type'][];
  providerCallTypes(): readonly FakeSessionProtocolCall['type'][];
}

const descriptorFrom = (definition: ReturnType<typeof validateAgentDefinition>): AgentDescriptor =>
  Object.freeze({
    agent: Object.freeze({ id: definition.definition.id, version: definition.definition.version }),
    capabilities: definition.definition.capabilities,
    definitionDigest: definition.digest,
    displayName: definition.definition.displayName,
  });

export const createAgentSessionStory = (options: AgentSessionStoryOptions): AgentSessionStory => {
  const events: AgentSessionEvent[] = [];
  const definition = validateAgentDefinition(
    agentDefinition({
      capabilities: {
        cancellation: true,
        session: capabilities,
        structuredResult: true,
        usage: true,
      },
      id: 'fake-session-agent',
      version: '1',
    }),
  );
  const driver = createControllableSessionProtocolDriver({
    checkpoints: [
      {
        continuation: { data: options.checkpoint, format: 'fake/v1' },
        status: 'captured',
      },
    ],
    closes: [{ status: 'closed' }],
    openings: [
      {
        kind: 'fresh',
        outcome: { capabilities: protocolCapabilities, status: 'opened' },
        steps: [],
      },
    ],
    prompts: options.replies.map((content) => ({
      outcome: { status: 'completed' as const },
      steps: [{ type: 'update' as const, value: { content, type: 'message.delta' as const } }],
    })),
  });
  const clock: SessionClock = {
    now: () => ({ iso: '2026-09-05T00:00:00.000Z', milliseconds: 1_000 }),
    schedule: () => ({ cancel: () => undefined }),
  };
  const digest = {
    digest: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
  };
  let resourceIdentity = 0;
  const composition = composeSessionInterpreters({
    activeStateSink: {
      remove: async () => ({ state: 'applied' }),
      save: async () => ({ state: 'applied' }),
    },
    clock,
    digest,
    driver,
    eventSink: {
      append: async (event) => {
        events.push(event);
        return { state: 'appended' };
      },
    },
    identities: { next: (kind) => `${kind}-${++resourceIdentity}` },
    preparer: {
      prepare: async (opening) => ({
        status: 'prepared',
        value: {
          definition: definition.definition,
          launch: {
            args: [],
            command: definition.definition.launch.command,
            cwd: opening.request.request.workspace.directory,
          },
          output: {
            publish: async () => ({
              files: {
                directory: opening.request.request.output.directory,
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
    spawner: {
      start: async () => ({
        completion: new Promise<never>(() => undefined),
        identity: {
          fingerprint: 'fake-process',
          pid: 42,
          processGroupId: 42,
          startedAt: clock.now().iso,
        },
        terminateAndReap: async () => ({
          exit: { exitCode: 0, signal: null },
          status: 'confirmed',
        }),
        transport: {
          input: new WritableStream<Uint8Array>(),
          output: new ReadableStream<Uint8Array>({
            start: (controller) => controller.close(),
          }),
        },
      }),
    },
    timer: clock,
  });
  const runtimeFactory = new SessionActorFactory({
    clock,
    dispatcher: new SessionEffectDispatcher(composition.interpreters),
    reducer: reduceSession,
  });
  let identity = 0;
  const sessions = createManagedAgentSessions({
    agents: [descriptorFrom(definition)],
    clock,
    digest,
    nextIdentity: (kind) => `${kind}-${++identity}`,
    runtimeFactory,
  });
  return Object.freeze({
    eventTypes: () => Object.freeze(events.map(({ type }) => type)),
    open: (sessionId: string) =>
      sessions.open({
        agent: { id: 'fake-session-agent', version: '1' },
        output: { directory: '/output' },
        parameters: {},
        permissions: {},
        sessionId,
        workspace: { directory: '/workspace' },
      }),
    providerCallTypes: () => Object.freeze(driver.calls.map(({ type }) => type)),
    sessions,
  });
};
