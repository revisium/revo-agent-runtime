import { createHash } from 'node:crypto';

import { createManagedAgentSessions } from '../../../../src/application/session/management/managed-sessions.js';
import type { AgentDescriptor } from '../../../../src/contracts/manager.js';
import type {
  AgentSessionEvent,
  AgentSession,
  AgentSessionLaunchContext,
  AgentSessionLimits,
  AgentSessionResumeToken,
  AgentSessions,
} from '../../../../src/contracts/session.js';
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
import { StoryProcesses } from './processes.js';
import { createStoryProtocolScript, type AgentSessionStoryOptions } from './script.js';

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

export interface AgentSessionStory {
  readonly sessions: AgentSessions;
  open(
    sessionId: string,
    options?: {
      readonly limits?: AgentSessionLimits;
      readonly context?: AgentSessionLaunchContext;
    },
  ): ReturnType<AgentSessions['open']>;
  close(session: AgentSession): Promise<void>;
  completeEmptySessions(sessionIds: readonly string[]): Promise<void>;
  resume(token: AgentSessionResumeToken): ReturnType<AgentSessions['resume']>;
  events(): readonly AgentSessionEvent[];
  eventTypes(): readonly AgentSessionEvent['type'][];
  providerCalls(): readonly FakeSessionProtocolCall[];
  providerCallTypes(): readonly FakeSessionProtocolCall['type'][];
  settle(): Promise<void>;
  waitForAgent(barrier: string): Promise<void>;
  releaseAgent(barrier: string): void;
  activeProcesses(): number;
  maximumActiveProcesses(): number;
  retainedPreparations(): number;
  retainedProviders(): number;
  exitAgent(): void;
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
  const driver = createControllableSessionProtocolDriver(
    createStoryProtocolScript(options, protocolCapabilities),
  );
  const clock: SessionClock = {
    now: () => ({ iso: '2026-09-05T00:00:00.000Z', milliseconds: 1_000 }),
    schedule: () => ({ cancel: () => undefined }),
  };
  const digest = {
    digest: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
  };
  const processes = new StoryProcesses(driver.barriers, options.processStartBarrier);
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
        if (event.type === options.rejectEvent) throw new Error('Fake event sink rejection.');
        if (event.type === options.stallEvent) await new Promise<never>(() => undefined);
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
          inputs: { parameters: {}, permissions: {} },
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
    spawner: processes,
  });
  const actorFactory = new SessionActorFactory({
    release: (identity) =>
      composition.resources.preparations.release({ ...identity, effectId: 'release' }),
    clock,
    dispatcher: new SessionEffectDispatcher(composition.interpreters),
    reducer: reduceSession,
  });
  const runtimes: ReturnType<SessionActorFactory['createOpening']>[] = [];
  const runtimeFactory = {
    createOpening: (command: Parameters<SessionActorFactory['createOpening']>[0]) => {
      const runtime = actorFactory.createOpening(command);
      runtimes.push(runtime);
      return runtime;
    },
  };
  let identity = 0;
  const sessions = createManagedAgentSessions({
    agents: [descriptorFrom(definition)],
    clock,
    digest,
    nextIdentity: (kind) => `${kind}-${++identity}`,
    runtimeFactory,
  });
  const launch = {
    output: { directory: '/output' },
    parameters: {},
    permissions: {},
    workspace: { directory: '/workspace' },
  } as const;
  const story: AgentSessionStory = {
    close: async (session) => {
      await session.close();
      await story.settle();
    },
    completeEmptySessions: async (sessionIds) => {
      const complete = async (sessionId: string): Promise<void> => {
        const session = await story.open(sessionId);
        await story.close(session);
      };
      for (const sessionId of sessionIds) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- exercises sequential lifetimes in one manager
        await complete(sessionId);
      }
    },
    exitAgent: () => processes.exit(),
    activeProcesses: () => processes.active,
    events: () => Object.freeze([...events]),
    eventTypes: () => Object.freeze(events.map(({ type }) => type)),
    maximumActiveProcesses: () => processes.maximum,
    retainedProviders: () => composition.resources.providers.size,
    retainedPreparations: () =>
      runtimes.filter(
        ({ state }) =>
          composition.resources.preparations.forSession({
            effectId: 'inspection',
            epoch: state.epoch,
            sessionId: state.sessionId,
          }) !== undefined,
      ).length,
    open: (sessionId, opening = {}) =>
      sessions.open(
        {
          ...launch,
          agent: { id: 'fake-session-agent', version: '1' },
          ...(options.eventSinkTimeoutMs === undefined
            ? {}
            : { limits: { eventSinkTimeoutMs: options.eventSinkTimeoutMs } }),
          ...(opening.limits === undefined ? {} : { limits: opening.limits }),
          sessionId,
        },
        opening.context,
      ),
    providerCalls: () => Object.freeze([...driver.calls]),
    providerCallTypes: () => Object.freeze(driver.calls.map(({ type }) => type)),
    releaseAgent: (barrier: string) => driver.barriers.release(barrier),
    resume: (token: AgentSessionResumeToken) => sessions.resume({ ...launch, token }),
    settle: async () => {
      await Promise.all(runtimes.map((runtime) => runtime.whenQuiescent()));
    },
    sessions,
    waitForAgent: (barrier: string) => driver.barriers.reached(barrier),
  };
  return Object.freeze(story);
};
