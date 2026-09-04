import type { PublicSessionCommand } from '../../../../../src/execution/session/kernel/command/public.js';
import type { SessionOpeningDescriptor } from '../../../../../src/execution/session/kernel/model/opening-state.js';

const observedAt = '2026-03-21T00:00:00.000Z';
const observedAtMs = 1_000;
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
const base = {
  acceptedAt: observedAt,
  acceptedAtMs: 1_000,
  incarnationId: 'incarnation_01',
  limits,
  pin,
  streamId: 'stream_01',
  usageBaseline: { scope: 'session_cumulative' },
} as const;

const freshOpening = {
  ...base,
  request: {
    kind: 'fresh',
    request: { ...launch, agent: { id: 'codex', version: '1' }, sessionId: 'session_01' },
  },
} satisfies SessionOpeningDescriptor;

const resumeOpening = {
  ...base,
  request: {
    continuation: { data: { providerSessionId: 'provider_01' }, format: 'acp/v1' },
    kind: 'resume',
    request: {
      ...launch,
      token: {
        cursor: { eventId: 'previous_event', sequence: 9, streamId: 'previous_stream' },
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

export const sessionOpeningCommand = (
  mode: 'fresh' | 'resume' = 'fresh',
): Extract<PublicSessionCommand, { readonly type: 'session.open' | 'session.resume' }> =>
  mode === 'fresh'
    ? {
        call: { callId: 'call_01', epoch: 1, sessionId: 'session_01' },
        observedAt,
        observedAtMs,
        opening: freshOpening,
        type: 'session.open',
      }
    : {
        call: { callId: 'call_01', epoch: 1, sessionId: 'session_01' },
        observedAt,
        observedAtMs,
        opening: resumeOpening,
        type: 'session.resume',
      };

export const sessionCapabilities = {
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;

export const sessionProcess = {
  fingerprint: 'fingerprint',
  pid: 42,
  processGroupId: 42,
  startedAt: observedAt,
} as const;

export const outcomeTime = observedAt;
export const outcomeTimeMs = observedAtMs;
