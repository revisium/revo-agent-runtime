import type { InteractionState } from '../../../../../src/execution/session/kernel/model/interaction-state.js';
import type { TurnState } from '../../../../../src/execution/session/kernel/model/turn-state.js';

const correlation = {
  effectId: 'effect_01',
  epoch: 1,
  sessionId: 'session_01',
  turnId: 'turn_01',
} as const;
const turn = {
  handleCallId: 'send_01',
  prompt: 'continue',
  resultCallId: 'turn_result_01',
  turnId: 'turn_01',
} as const;
const activeTurn = {
  ...turn,
  correlation,
  message: { content: 'working', role: 'assistant' },
  usage: { inputTokens: 1, scope: 'session_cumulative' },
} as const;
const fault = {
  code: 'revo.agent.internal',
  message: 'failed',
  phase: 'session_running',
  retryable: false,
} as const;

type TurnByStatus = {
  readonly [Status in TurnState['status']]: Extract<TurnState, { readonly status: Status }>;
};

const turns = {
  starting: { ...turn, status: 'starting' },
  prompting: { ...activeTurn, status: 'prompting' },
  streaming: { ...activeTurn, status: 'streaming' },
  awaiting_interaction: { ...activeTurn, status: 'awaiting_interaction' },
  settling: {
    ...activeTurn,
    progress: { outcome: { status: 'completed' }, stage: 'publishing_completion' },
    status: 'settling',
  },
  completed: {
    ...turn,
    result: { message: { content: 'done', role: 'assistant' }, status: 'completed' },
    status: 'completed',
  },
  cancelled: { ...turn, result: { status: 'cancelled' }, status: 'cancelled' },
  timed_out: { ...turn, result: { status: 'timed_out' }, status: 'timed_out' },
  interrupted: { ...turn, result: { status: 'interrupted' }, status: 'interrupted' },
  failed: { ...turn, result: { error: fault, status: 'failed' }, status: 'failed' },
} satisfies TurnByStatus;

const request = {
  action: { kind: 'execute' },
  kind: 'permission',
  options: [{ kind: 'allow_once', label: 'Allow', optionId: 'allow' }],
  requestId: 'request_01',
} as const;
const interactionBase = {
  providerResourceId: 'provider_01',
  request,
  scope: { kind: 'turn', turnId: 'turn_01' },
} as const;

type InteractionByStage = {
  readonly [Stage in InteractionState['stage']]: Extract<
    InteractionState,
    { readonly stage: Stage }
  >;
};

const interactions = {
  publishing: { ...interactionBase, stage: 'publishing' },
  ready: { ...interactionBase, stage: 'ready' },
  responding: {
    ...interactionBase,
    delivery: { stage: 'publishing' },
    response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
    stage: 'responding',
  },
} satisfies InteractionByStage;

const delivering = {
  ...interactions.responding,
  delivery: { correlation, stage: 'delivering' },
} satisfies InteractionState;

void turns;
void interactions;
void delivering;
