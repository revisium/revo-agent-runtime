import type {
  ActiveProcessIdentity,
  AgentFault,
} from '../../../../../src/contracts/manager/core.js';
import type { AgentSessionEvent } from '../../../../../src/contracts/session/events/event.js';
import type { ActiveAgentSessionSnapshot } from '../../../../../src/contracts/session/persistence/active-state.js';
import type { SessionEffect } from '../../../../../src/execution/session/kernel/effect/session-effect.js';
import type { SessionOpeningDescriptor } from '../../../../../src/execution/session/kernel/model/opening-state.js';

declare const opening: SessionOpeningDescriptor;
declare const event: AgentSessionEvent;
declare const snapshot: ActiveAgentSessionSnapshot;

const correlation = {
  effectId: 'effect_01',
  epoch: 1,
  sessionId: 'session_01',
} as const;
const turnCorrelation = { ...correlation, turnId: 'turn_01' } as const;
const process = {
  fingerprint: 'fingerprint',
  pid: 42,
  processGroupId: 42,
  startedAt: '2026-03-21T00:00:00.000Z',
} satisfies ActiveProcessIdentity;
const fault = {
  code: 'revo.agent.internal',
  message: 'failed',
  phase: 'session_running',
  retryable: false,
} satisfies AgentFault;
const pin = { agentId: 'codex', agentVersion: '1', definitionDigest: 'digest' } as const;
const cursor = { eventId: 'event_01', sequence: 1, streamId: 'stream_01' } as const;
const timeoutMs = 1_000;

type EffectByType = {
  readonly [Type in SessionEffect['type']]: Extract<SessionEffect, { readonly type: Type }>;
};

const effects = {
  'opening.prepare': { correlation, opening, timeoutMs, type: 'opening.prepare' },
  'process.start': {
    correlation,
    preparationId: 'preparation_01',
    timeoutMs,
    type: 'process.start',
  },
  'provider.open': {
    correlation,
    preparationId: 'preparation_01',
    processResourceId: 'process_01',
    timeoutMs,
    type: 'provider.open',
  },
  'provider.prompt': {
    correlation: turnCorrelation,
    input: { prompt: 'continue', turnId: 'turn_01' },
    providerResourceId: 'provider_01',
    timeoutMs,
    type: 'provider.prompt',
  },
  'provider.interaction.respond': {
    correlation: turnCorrelation,
    providerResourceId: 'provider_01',
    request: { kind: 'input', message: 'Choose', questions: [], requestId: 'request_01' },
    response: { kind: 'input', outcome: 'declined' },
    scope: { kind: 'turn', turnId: 'turn_01' },
    timeoutMs,
    type: 'provider.interaction.respond',
  },
  'provider.turn.cancel': {
    correlation: turnCorrelation,
    providerResourceId: 'provider_01',
    timeoutMs,
    turnId: 'turn_01',
    type: 'provider.turn.cancel',
  },
  'provider.close': {
    correlation,
    providerResourceId: 'provider_01',
    timeoutMs,
    type: 'provider.close',
  },
  'event.append': {
    correlation,
    event,
    expected: { kind: 'empty' },
    timeoutMs,
    type: 'event.append',
  },
  'persistence.save': { correlation, snapshot, timeoutMs, type: 'persistence.save' },
  'persistence.remove': {
    correlation,
    incarnationId: 'incarnation_01',
    timeoutMs,
    type: 'persistence.remove',
  },
  'checkpoint.capture': {
    checkpointId: 'checkpoint_01',
    correlation,
    cursor,
    kind: 'checkpoint',
    maxBytes: 1_024,
    pin,
    providerResourceId: 'provider_01',
    timeoutMs,
    type: 'checkpoint.capture',
    usageBaseline: { scope: 'session_cumulative' },
  },
  'timer.schedule': {
    correlation,
    timer: { deadlineMs: 1_000, generation: 1, kind: 'idle', timerId: 'timer_01' },
    type: 'timer.schedule',
  },
  'timer.cancel': { correlation, generation: 1, timerId: 'timer_01', type: 'timer.cancel' },
  'output.publish': {
    correlation,
    maxBytes: 1_024,
    outputDirectory: '/output',
    publication: {
      acceptedAt: '2026-03-21T00:00:00.000Z',
      cursor,
      finishedAt: '2026-03-21T00:01:00.000Z',
      pin,
      sessionId: 'session_01',
      status: 'closed',
    },
    type: 'output.publish',
  },
  'process.cleanup': {
    correlation,
    process,
    processResourceId: 'process_01',
    timeoutMs,
    type: 'process.cleanup',
  },
  'public.resolve': {
    callId: 'call_01',
    correlation,
    resolution: { kind: 'session_ready' },
    type: 'public.resolve',
  },
  'public.reject': { callId: 'call_01', correlation, fault, type: 'public.reject' },
} satisfies EffectByType;

const hibernationCapture = {
  correlation,
  cursor,
  kind: 'hibernate',
  maxBytes: 1_024,
  pin,
  providerResourceId: 'provider_01',
  resumeTokenId: 'token_01',
  timeoutMs,
  type: 'checkpoint.capture',
  usageBaseline: { scope: 'session_cumulative' },
} satisfies Extract<SessionEffect, { readonly type: 'checkpoint.capture' }>;

void effects;
void hibernationCapture;
