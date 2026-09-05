import type { JsonObject } from '../../../../src/contracts/agent-definition.js';
import type {
  AgentSessionEvent,
  AgentSessionInteractiveRequest,
} from '../../../../src/contracts/session.js';
import type {
  SessionProtocolCancellationOutcome,
  SessionProtocolInteractionOutcome,
  SessionProtocolPromptOutcome,
} from '../../../../src/protocol/session/model/outcome.js';
import type { SessionProtocolCapabilities } from '../../../../src/protocol/session/model/outcome.js';
import type {
  FakeSessionProtocolInteractionScript,
  FakeSessionProtocolScript,
} from '../fakes/protocol/script.js';

type AgentStoryTurnStep =
  | { readonly type: 'reply'; readonly content: string }
  | { readonly type: 'interaction'; readonly request: AgentSessionInteractiveRequest }
  | { readonly type: 'wait'; readonly barrier: string };

interface AgentStoryTurn {
  readonly steps: readonly AgentStoryTurnStep[];
  readonly outcome?: SessionProtocolPromptOutcome;
}

export interface AgentSessionStoryOptions {
  readonly checkpoint?: Readonly<JsonObject>;
  readonly checkpoints?: readonly Readonly<JsonObject>[];
  readonly replies?: readonly string[];
  readonly turns?: readonly AgentStoryTurn[];
  readonly openings?: readonly ('fresh' | 'resume')[];
  readonly closes?: number;
  readonly cancellations?: readonly SessionProtocolCancellationOutcome[];
  readonly interactions?: readonly (
    | SessionProtocolInteractionOutcome
    | FakeSessionProtocolInteractionScript
  )[];
  readonly eventSinkTimeoutMs?: number;
  readonly rejectEvent?: AgentSessionEvent['type'];
  readonly stallEvent?: AgentSessionEvent['type'];
}

const turnSteps = (turn: AgentStoryTurn) =>
  turn.steps.map((step) => {
    if (step.type === 'reply')
      return {
        type: 'update' as const,
        value: { content: step.content, type: 'message.delta' as const },
      };
    if (step.type === 'interaction')
      return {
        type: 'update' as const,
        value: { request: step.request, type: 'interaction.requested' as const },
      };
    return { barrier: step.barrier, type: 'wait' as const };
  });

export const createStoryProtocolScript = (
  options: AgentSessionStoryOptions,
  capabilities: SessionProtocolCapabilities,
): FakeSessionProtocolScript => {
  const turns: readonly AgentStoryTurn[] =
    options.turns ??
    (options.replies ?? []).map((content) => ({
      steps: [{ content, type: 'reply' as const }],
    }));
  const checkpoints =
    options.checkpoints ?? (options.checkpoint === undefined ? [] : [options.checkpoint]);
  const openings = options.openings ?? ['fresh'];
  return {
    cancellations: options.cancellations ?? [],
    checkpoints: checkpoints.map((data) => ({
      continuation: { data, format: 'fake/v1' },
      status: 'captured',
    })),
    closes: Array.from({ length: options.closes ?? openings.length }, () => ({
      status: 'closed' as const,
    })),
    interactions: options.interactions ?? [],
    openings: openings.map((kind) => ({
      kind,
      outcome: { capabilities, status: 'opened' as const },
      steps: [],
    })),
    prompts: turns.map((turn) => ({
      outcome: turn.outcome ?? { status: 'completed' },
      steps: turnSteps(turn),
    })),
  };
};
