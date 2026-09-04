import type { ProviderCommand } from '../../../../../src/execution/session/kernel/command/provider.js';
import type { PublicSessionCommand } from '../../../../../src/execution/session/kernel/command/public.js';
import type { TimerCommand } from '../../../../../src/execution/session/kernel/command/timer.js';
import type { SessionOpeningDescriptor } from '../../../../../src/execution/session/kernel/model/opening-state.js';

const observedAt = '2026-03-21T00:00:00.000Z';
const commandTime = { observedAt, observedAtMs: 1_000 } as const;
const call = { callId: 'call_01', epoch: 1, sessionId: 'session_01' } as const;
const turnCall = { ...call, turnId: 'turn_01' } as const;
const correlation = { effectId: 'effect_01', epoch: 1, sessionId: 'session_01' } as const;
const turnCorrelation = { ...correlation, turnId: 'turn_01' } as const;
const pin = { agentId: 'codex', agentVersion: '1', definitionDigest: 'digest' } as const;
const limits = {
  eventSinkTimeoutMs: 1_000,
  idleTimeoutMs: 10_000,
  maxCheckpointBytes: 1_024,
  maxEventBytes: 1_024,
  maxInteractionBytes: 1_024,
  maxMessageBytes: 4_096,
  maxMetadataBytes: 1_024,
  maxOutputBytes: 4_096,
  maxPendingInteractions: 2,
  maxPromptBytes: 1_024,
  openingTimeoutMs: 10_000,
  operationTimeoutMs: 1_000,
  wallClockTimeoutMs: 60_000,
} as const;
const launch = {
  output: { directory: '/output' },
  parameters: {},
  permissions: {},
  workspace: { directory: '/workspace' },
} as const;
const openingBase = {
  acceptedAt: observedAt,
  acceptedAtMs: 1_000,
  environment: { inherit: ['PATH'], secrets: {}, variables: {} },
  incarnationId: 'incarnation_01',
  limits,
  pin,
  streamId: 'stream_01',
  usageBaseline: { scope: 'session_cumulative' },
} as const;
const freshOpening = {
  ...openingBase,
  request: {
    kind: 'fresh',
    request: { ...launch, agent: { id: 'codex', version: '1' }, sessionId: 'session_01' },
  },
} satisfies SessionOpeningDescriptor;
const resumeOpening = {
  ...openingBase,
  request: {
    continuation: { data: { providerSessionId: 'provider_01' }, format: 'acp/v1' },
    kind: 'resume',
    request: {
      ...launch,
      token: {
        cursor: { eventId: 'event_01', sequence: 1, streamId: 'stream_01' },
        eligibility: 'hibernated',
        payload: 'payload',
        pin,
        resumeTokenId: 'token_01',
        schemaVersion: 'agent-session-resume-token/v1',
        sessionId: 'session_01',
        sha256: 'sha256',
      },
    },
  },
} satisfies SessionOpeningDescriptor;

type PublicCommandByType = {
  readonly [Type in PublicSessionCommand['type']]: Extract<
    PublicSessionCommand,
    { readonly type: Type }
  >;
};

const publicCommands = {
  'session.open': { call, ...commandTime, opening: freshOpening, type: 'session.open' },
  'session.resume': { call, ...commandTime, opening: resumeOpening, type: 'session.resume' },
  'turn.send': {
    call: turnCall,
    input: { prompt: 'continue', turnId: 'turn_01' },
    ...commandTime,
    resultCallId: 'turn_result_01',
    type: 'turn.send',
  },
  'interaction.respond': {
    call,
    input: { requestId: 'request_01', response: { kind: 'input', outcome: 'declined' } },
    ...commandTime,
    type: 'interaction.respond',
  },
  'turn.cancel': { call: turnCall, ...commandTime, turnId: 'turn_01', type: 'turn.cancel' },
  'session.checkpoint': {
    call,
    checkpointId: 'checkpoint_01',
    ...commandTime,
    type: 'session.checkpoint',
  },
  'session.hibernate': {
    call,
    ...commandTime,
    resumeTokenId: 'token_01',
    type: 'session.hibernate',
  },
  'session.close': { call, ...commandTime, type: 'session.close' },
  'session.cancel': { call, ...commandTime, type: 'session.cancel' },
  'manager.shutdown': { call, ...commandTime, type: 'manager.shutdown' },
} satisfies PublicCommandByType;

type ProviderCommandByType = {
  readonly [Type in ProviderCommand['type']]: Extract<ProviderCommand, { readonly type: Type }>;
};

const providerCommands = {
  'provider.message_delta': {
    content: 'Hello',
    correlation: turnCorrelation,
    ...commandTime,
    type: 'provider.message_delta',
  },
  'provider.message_completed': {
    contentBytes: 5,
    contentSha256: 'sha256',
    correlation: turnCorrelation,
    ...commandTime,
    type: 'provider.message_completed',
  },
  'provider.progress': {
    correlation: turnCorrelation,
    message: 'Working',
    ...commandTime,
    type: 'provider.progress',
  },
  'provider.tool': {
    correlation: turnCorrelation,
    kind: 'read',
    ...commandTime,
    status: 'completed',
    title: 'Read file',
    toolCallId: 'tool_01',
    type: 'provider.tool',
  },
  'provider.plan': {
    correlation: turnCorrelation,
    items: [{ itemId: 'item_01', status: 'pending', title: 'Check' }],
    ...commandTime,
    type: 'provider.plan',
  },
  'provider.interaction_requested': {
    correlation,
    ...commandTime,
    providerResourceId: 'provider_01',
    request: {
      action: { kind: 'execute' },
      kind: 'permission',
      options: [{ kind: 'allow_once', label: 'Allow', optionId: 'allow' }],
      requestId: 'request_01',
    },
    scope: { kind: 'opening' },
    type: 'provider.interaction_requested',
  },
  'provider.usage': {
    correlation: turnCorrelation,
    ...commandTime,
    type: 'provider.usage',
    usage: { inputTokens: 1, scope: 'session_cumulative' },
  },
} satisfies ProviderCommandByType;

const timer = {
  correlation,
  firedAt: observedAt,
  firedAtMs: 1_000,
  generation: 1,
  kind: 'wall_clock',
  timerId: 'timer_01',
  type: 'timer.fired',
} satisfies TimerCommand;

void publicCommands;
void providerCommands;
void timer;
