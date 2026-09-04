import type {
  ActiveProcessIdentity,
  AgentFault,
} from '../../../../../src/contracts/manager/core.js';
import type { SessionOpeningDescriptor } from '../../../../../src/execution/session/kernel/model/opening-state.js';
import type { SessionState } from '../../../../../src/execution/session/kernel/model/session-state.js';

declare const opening: SessionOpeningDescriptor;

const correlation = { effectId: 'effect_01', epoch: 1, sessionId: 'session_01' } as const;
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
const common = {
  acceptedAt: '2026-03-21T00:00:00.000Z',
  acceptedAtMs: 1_000,
  epoch: 1,
  events: { pending: [] },
  incarnationId: 'incarnation_01',
  interactions: [],
  limits,
  nextEffectSequence: 1,
  nextEventSequence: 1,
  outputDirectory: '/output',
  pin,
  sessionId: 'session_01',
  streamId: 'stream_01',
  timers: [],
  usage: { scope: 'session_cumulative' },
} as const;
const process = {
  fingerprint: 'fingerprint',
  pid: 42,
  processGroupId: 42,
  startedAt: common.acceptedAt,
} satisfies ActiveProcessIdentity;
const capabilities = {
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;
const active = {
  ...common,
  capabilities,
  openedAt: common.acceptedAt,
  process,
  processResourceId: 'process_01',
  providerResourceId: 'provider_01',
} as const;
const fault = {
  code: 'revo.agent.internal',
  message: 'failed',
  phase: 'session_terminal',
  retryable: false,
} satisfies AgentFault;
const resumeToken = {
  cursor: { eventId: 'event_01', sequence: 1, streamId: 'stream_01' },
  eligibility: 'hibernated',
  payload: 'payload',
  pin,
  resumeTokenId: 'token_01',
  schemaVersion: 'agent-session-resume-token/v1',
  sessionId: 'session_01',
  sha256: 'sha256',
} as const;
const finishedAt = '2026-03-21T00:01:00.000Z';

type StateByStatus = {
  readonly [Status in SessionState['status']]: Extract<SessionState, { readonly status: Status }>;
};

const states = {
  opening: {
    ...common,
    callId: 'call_01',
    progress: { opening, stage: 'publishing_accepted' },
    status: 'opening',
  },
  idle: { ...active, status: 'idle' },
  running: {
    ...active,
    status: 'running',
    turn: {
      handleCallId: 'send_01',
      prompt: 'continue',
      resultCallId: 'turn_result_01',
      status: 'starting',
      turnId: 'turn_01',
    },
  },
  checkpointing: {
    ...active,
    callId: 'call_01',
    checkpointId: 'checkpoint_01',
    progress: { correlation, stage: 'capturing' },
    status: 'checkpointing',
  },
  hibernating: {
    ...active,
    callId: 'call_01',
    progress: { correlation, stage: 'capturing' },
    resumeTokenId: 'token_01',
    status: 'hibernating',
  },
  closing: {
    ...active,
    callIds: ['call_01'],
    intent: { outcome: 'closed' },
    progress: { correlation, stage: 'closing_provider' },
    status: 'closing',
  },
  cancelling: {
    ...active,
    callIds: ['call_01'],
    intent: { outcome: 'cancelled' },
    progress: { correlation, stage: 'closing_provider' },
    status: 'cancelling',
  },
  hibernated: { ...common, finishedAt, resumeToken, status: 'hibernated' },
  closed: { ...common, finishedAt, status: 'closed' },
  cancelled: { ...common, finishedAt, status: 'cancelled' },
  timed_out: { ...common, error: fault, finishedAt, status: 'timed_out' },
  failed: { ...common, error: fault, finishedAt, status: 'failed' },
  cleanup_uncertain: {
    ...common,
    error: fault,
    process,
    processResourceId: 'process_01',
    status: 'cleanup_uncertain',
  },
} satisfies StateByStatus;

void states;

declare const immutableState: SessionState;

// @ts-expect-error Kernel state discriminants are immutable.
immutableState.status = 'idle';
// @ts-expect-error Kernel timer collections are immutable.
immutableState.timers[0] = {
  deadlineMs: 1,
  generation: 1,
  kind: 'idle',
  timerId: 'timer_02',
};
