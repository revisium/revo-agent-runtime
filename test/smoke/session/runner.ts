import type {
  ActiveAgentSessionSnapshot,
  AgentDefinitionInput,
  AgentSessionEvent,
  AgentSessionLaunchContext,
  AgentSessionTurnResult,
} from '../../../src/index.js';
import { createAgentManager } from '../../../src/index.js';
import { configurationForSessionSmoke } from './configuration.js';
import type {
  SessionCancellationEvidence,
  SessionContinuityEvidence,
  SessionInteractionEvidence,
} from './evidence.js';

interface SessionScenarioBase {
  readonly context?: AgentSessionLaunchContext;
  readonly definition: AgentDefinitionInput;
  readonly outputDirectory: string;
  readonly preferredModel?: string;
  readonly workspaceDirectory: string;
}

export interface SessionContinuityScenario extends SessionScenarioBase {
  readonly nonce: string;
}

export interface SessionCancellationScenario extends SessionScenarioBase {
  readonly cancelDelayMs: number;
}

export type SessionInteractionScenario = SessionScenarioBase;

interface ScenarioState {
  readonly active: Map<string, ActiveAgentSessionSnapshot>;
  readonly events: AgentSessionEvent[];
}

const createScenarioState = (): ScenarioState => ({ active: new Map(), events: [] });

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForInteraction = async (
  state: ScenarioState,
  kind: 'input' | 'permission',
): Promise<Extract<AgentSessionEvent, { readonly type: 'interaction.requested' }>> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const event = state.events.find(
      (
        candidate,
      ): candidate is Extract<AgentSessionEvent, { readonly type: 'interaction.requested' }> =>
        candidate.type === 'interaction.requested' && candidate.request.kind === kind,
    );
    if (event !== undefined) return event;
    // oxlint-disable-next-line no-await-in-loop -- bounded polling intentionally waits between observations
    await delay(10);
  }
  throw new Error(`Session smoke did not observe the ${kind} interaction.`);
};

const sessionIdFor = (providerId: string, suffix: string): string =>
  `dlg_${providerId.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}_${suffix}`;

const createScenarioManager = (definition: AgentDefinitionInput, state: ScenarioState) =>
  createAgentManager({
    activeStateSink: {
      remove: async () => undefined,
      save: async () => undefined,
    },
    definitions: [definition],
    sessions: {
      activeStateSink: {
        remove: async ({ incarnationId, sessionId }) => {
          if (state.active.get(sessionId)?.incarnationId !== incarnationId)
            return { state: 'not_owner' };
          state.active.delete(sessionId);
          return { state: 'applied' };
        },
        save: async (snapshot) => {
          state.active.set(snapshot.sessionId, snapshot);
          return { state: 'applied' };
        },
      },
      eventSink: {
        append: async (event) => {
          state.events.push(event);
          return { state: 'appended' };
        },
      },
    },
  });

const requireClean = (state: ScenarioState): 'confirmed' => {
  if (state.active.size !== 0) throw new Error('Session smoke left active-state rows behind.');
  return 'confirmed';
};

const requireSessionAgent = (
  manager: ReturnType<typeof createAgentManager>,
  definition: AgentDefinitionInput,
): void => {
  if (!manager.sessions.listAgents().some(({ agent }) => agent.id === definition.id))
    throw new Error('Selected definition did not advertise session support.');
};

const requireAvailable = async (
  manager: ReturnType<typeof createAgentManager>,
  definition: AgentDefinitionInput,
): Promise<void> => {
  const probe = await manager.probeAgent({ id: definition.id, version: definition.version });
  if (probe.status !== 'available') throw new Error('Selected session provider is unavailable.');
};

function requireCompleted(
  result: AgentSessionTurnResult,
  label: string,
): asserts result is Extract<AgentSessionTurnResult, { readonly status: 'completed' }> {
  if (result.status !== 'completed') {
    const fault = result.status === 'failed' ? `; fault=${result.error.code}` : '';
    throw new Error(`${label} session turn ended with ${result.status}${fault}.`);
  }
}

export const runSessionContinuityScenario = async ({
  context,
  definition,
  nonce,
  outputDirectory,
  preferredModel,
  workspaceDirectory,
}: SessionContinuityScenario): Promise<SessionContinuityEvidence> => {
  const state = createScenarioState();
  const manager = createScenarioManager(definition, state);
  const turnStatuses: AgentSessionTurnResult['status'][] = [];
  let resume: SessionContinuityEvidence['resume'] = 'unsupported';
  let nonceMatched = false;
  try {
    await manager.initialize({ invocations: [], sessions: [] });
    requireSessionAgent(manager, definition);
    await requireAvailable(manager, definition);
    const catalog = await manager.inspectConfiguration(
      {
        agent: { id: definition.id, version: definition.version },
        workspace: { directory: workspaceDirectory },
      },
      context,
    );
    const session = await manager.sessions.open(
      {
        agent: { id: definition.id, version: definition.version },
        configuration: configurationForSessionSmoke(catalog, preferredModel),
        limits: { idleTimeoutMs: 30_000, wallClockTimeoutMs: 90_000 },
        output: { directory: outputDirectory },
        parameters: {},
        permissions: {},
        sessionId: sessionIdFor(definition.id, 'continuity'),
        workspace: { directory: workspaceDirectory },
      },
      context,
    );
    const first = await (
      await session.send({
        prompt: `Do not use tools. Remember this non-secret verification token for the next turn. Your entire reply must be exactly: ${nonce}`,
        turnId: 'trn_remember',
      })
    ).result();
    turnStatuses.push(first.status);
    requireCompleted(first, 'First');
    const second = await (
      await session.send({
        prompt:
          'Do not use tools. Return only the exact verification token from your immediately preceding reply.',
        turnId: 'trn_recall',
      })
    ).result();
    turnStatuses.push(second.status);
    requireCompleted(second, 'Second');
    nonceMatched = second.message.content.includes(nonce);
    if (!nonceMatched) throw new Error('Session provider did not retain the generated nonce.');

    if (session.capabilities.resume === 'native') {
      const hibernated = await session.hibernate('manual session smoke');
      const resumed = await manager.sessions.resume(
        {
          output: { directory: `${outputDirectory}-resumed` },
          parameters: {},
          permissions: {},
          token: hibernated.resumeToken,
          workspace: { directory: workspaceDirectory },
        },
        context,
      );
      const third = await (
        await resumed.send({
          prompt: 'Return the exact token retained before hibernation.',
          turnId: 'trn_resume',
        })
      ).result();
      turnStatuses.push(third.status);
      requireCompleted(third, 'Resumed');
      if (!third.message.content.includes(nonce))
        throw new Error('Native resume did not retain the generated nonce.');
      resume = 'passed';
      await resumed.close('manual session smoke complete');
    } else {
      await session.close('manual session smoke complete');
    }
    return {
      cleanup: requireClean(state),
      eventCount: state.events.length,
      nonceMatched,
      providerId: definition.id,
      resume,
      turnStatuses,
    };
  } finally {
    await manager.shutdown('manual session smoke cleanup');
  }
};

export const runSessionCancellationScenario = async ({
  cancelDelayMs,
  context,
  definition,
  outputDirectory,
  preferredModel,
  workspaceDirectory,
}: SessionCancellationScenario): Promise<SessionCancellationEvidence> => {
  const state = createScenarioState();
  const manager = createScenarioManager(definition, state);
  let status: AgentSessionTurnResult['status'] = 'failed';
  try {
    await manager.initialize({ invocations: [], sessions: [] });
    requireSessionAgent(manager, definition);
    await requireAvailable(manager, definition);
    const catalog = await manager.inspectConfiguration(
      {
        agent: { id: definition.id, version: definition.version },
        workspace: { directory: workspaceDirectory },
      },
      context,
    );
    const session = await manager.sessions.open(
      {
        agent: { id: definition.id, version: definition.version },
        configuration: configurationForSessionSmoke(catalog, preferredModel),
        limits: { idleTimeoutMs: 30_000, wallClockTimeoutMs: 60_000 },
        output: { directory: outputDirectory },
        parameters: {},
        permissions: {},
        sessionId: sessionIdFor(definition.id, 'cancel'),
        workspace: { directory: workspaceDirectory },
      },
      context,
    );
    const turn = await session.send({
      prompt: 'Run the read-only shell command sleep 30 before replying.',
      turnId: 'trn_cancel',
    });
    await delay(cancelDelayMs);
    await turn.cancel('manual session cancellation smoke');
    const result = await turn.result();
    status = result.status;
    if (status !== 'cancelled') throw new Error(`Cancelled session turn ended with ${status}.`);
    const next = await (
      await session.send({
        prompt: 'Do not use tools. Reply with a short acknowledgement.',
        turnId: 'trn_after_cancel',
      })
    ).result();
    requireCompleted(next, 'After cancellation');
    await session.close('manual cancellation smoke complete');
    return {
      nextTurnStatus: next.status,
      cleanup: requireClean(state),
      eventCount: state.events.length,
      providerId: definition.id,
      status,
    };
  } finally {
    await manager.shutdown('manual session smoke cleanup');
  }
};

export const runSessionInteractionScenario = async ({
  context,
  definition,
  outputDirectory,
  preferredModel,
  workspaceDirectory,
}: SessionInteractionScenario): Promise<SessionInteractionEvidence> => {
  const state = createScenarioState();
  const manager = createScenarioManager(definition, state);
  try {
    await manager.initialize({ invocations: [], sessions: [] });
    requireSessionAgent(manager, definition);
    await requireAvailable(manager, definition);
    const catalog = await manager.inspectConfiguration(
      {
        agent: { id: definition.id, version: definition.version },
        workspace: { directory: workspaceDirectory },
      },
      context,
    );
    const session = await manager.sessions.open(
      {
        agent: { id: definition.id, version: definition.version },
        configuration: configurationForSessionSmoke(catalog, preferredModel),
        limits: { idleTimeoutMs: 30_000, wallClockTimeoutMs: 60_000 },
        output: { directory: outputDirectory },
        parameters: {},
        permissions: {},
        sessionId: sessionIdFor(definition.id, 'interactions'),
        workspace: { directory: workspaceDirectory },
      },
      context,
    );
    const turn = await session.send({
      prompt: 'Request the deterministic fixture interactions.',
      turnId: 'trn_interactions',
    });
    const permission = await waitForInteraction(state, 'permission');
    if (permission.request.kind !== 'permission')
      throw new Error('Session smoke permission request changed kind.');
    const allowed = permission.request.options.find(({ kind }) => kind === 'allow_once');
    if (allowed === undefined)
      throw new Error('Session smoke permission request cannot be allowed.');
    await session.respond({
      requestId: permission.request.requestId,
      response: { kind: 'permission', optionId: allowed.optionId, outcome: 'selected' },
    });
    const input = await waitForInteraction(state, 'input');
    if (input.request.kind !== 'input')
      throw new Error('Session smoke input request changed kind.');
    await session.respond({
      requestId: input.request.requestId,
      response: { kind: 'input', outcome: 'submitted', values: { tasks: ['tests', 'docs'] } },
    });
    const result = await turn.result();
    requireCompleted(result, 'Interaction');
    await session.close('manual interaction smoke complete');
    return {
      cleanup: requireClean(state),
      eventCount: state.events.length,
      interactionKinds: ['permission', 'input'],
      providerId: definition.id,
      resolvedCount: state.events.filter(({ type }) => type === 'interaction.resolved').length,
      status: result.status,
    };
  } finally {
    await manager.shutdown('manual session smoke cleanup');
  }
};
