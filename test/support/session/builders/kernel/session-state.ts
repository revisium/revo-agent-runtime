import type { SessionState } from '../../../../../src/execution/session/kernel/model/session-state.js';

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
const pin = { agentId: 'codex', agentVersion: '1', definitionDigest: 'digest' } as const;

export const idleSessionState = (): Extract<SessionState, { readonly status: 'idle' }> => ({
  acceptedAt: '2026-03-21T00:00:00.000Z',
  acceptedAtMs: 1_000,
  capabilities: {
    interactions: { input: true, permission: true },
    multiTurn: true,
    resume: 'native',
    updates: { message: true, plan: true, progress: true, tool: true, usage: true },
  },
  epoch: 1,
  events: {
    cursor: { eventId: 'session_01:1:event:2', sequence: 2, streamId: 'stream_01' },
    pending: [],
  },
  incarnationId: 'incarnation_01',
  interactions: [],
  limits,
  nextEffectSequence: 10,
  nextEventSequence: 3,
  openedAt: '2026-03-21T00:00:01.000Z',
  outputDirectory: '/output',
  pin,
  process: {
    fingerprint: 'fingerprint',
    pid: 42,
    processGroupId: 42,
    startedAt: '2026-03-21T00:00:00.500Z',
  },
  processResourceId: 'process_01',
  providerResourceId: 'provider_01',
  sessionId: 'session_01',
  status: 'idle',
  streamId: 'stream_01',
  timers: [
    { deadlineMs: 61_000, generation: 1, kind: 'wall_clock', timerId: 'session_01:1:wall' },
    { deadlineMs: 11_000, generation: 1, kind: 'idle', timerId: 'session_01:1:idle' },
  ],
  usage: { scope: 'session_cumulative' },
});
