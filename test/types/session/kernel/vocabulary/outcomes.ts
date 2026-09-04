import type { AgentFault } from '../../../../../src/contracts/manager/core.js';
import type { EffectOutcomeCommand } from '../../../../../src/execution/session/kernel/command/effect.js';

const correlation = {
  effectId: 'effect_01',
  epoch: 1,
  sessionId: 'session_01',
} as const;
const observedAt = '2026-03-21T00:00:00.000Z';
const fault = {
  code: 'revo.agent.internal',
  message: 'failed',
  phase: 'session_running',
  retryable: false,
} satisfies AgentFault;
const process = {
  fingerprint: 'fingerprint',
  pid: 42,
  processGroupId: 42,
  startedAt: observedAt,
} as const;
const capabilities = {
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;
const cursor = { eventId: 'event_01', sequence: 1, streamId: 'stream_01' } as const;
const pin = { agentId: 'codex', agentVersion: '1', definitionDigest: 'digest' } as const;
const continuation = {
  cursor,
  eligibility: 'observation_only',
  payload: 'payload',
  pin,
  checkpointId: 'checkpoint_01',
  schemaVersion: 'agent-session-checkpoint/v1',
  sessionId: 'session_01',
  sha256: 'sha256',
} as const;
const resumeToken = {
  cursor,
  eligibility: 'hibernated',
  payload: 'payload',
  pin,
  resumeTokenId: 'token_01',
  schemaVersion: 'agent-session-resume-token/v1',
  sessionId: 'session_01',
  sha256: 'sha256',
} as const;
const base = { correlation, observedAt, observedAtMs: 1_000 } as const;
const failed = { ...base, fault } as const;
const turnBase = {
  correlation: { ...correlation, turnId: 'turn_01' },
  observedAt,
  observedAtMs: 1_000,
} as const;
const turnFailed = { ...turnBase, fault } as const;

type OutcomeByType = {
  readonly [Type in EffectOutcomeCommand['type']]: Extract<
    EffectOutcomeCommand,
    { readonly type: Type }
  >;
};

const outcomes = {
  'opening.preparation.succeeded': {
    ...base,
    preparationId: 'preparation_01',
    type: 'opening.preparation.succeeded',
  },
  'opening.preparation.rejected': { ...failed, type: 'opening.preparation.rejected' },
  'opening.preparation.failed': { ...failed, type: 'opening.preparation.failed' },
  'opening.preparation.timed_out': { ...failed, type: 'opening.preparation.timed_out' },
  'process.started': { ...base, process, processResourceId: 'process_01', type: 'process.started' },
  'process.failed': { ...failed, type: 'process.failed' },
  'process.timed_out': { ...failed, type: 'process.timed_out' },
  'process.late_started': {
    ...base,
    process,
    processResourceId: 'process_01',
    type: 'process.late_started',
  },
  'provider.opened': {
    ...base,
    capabilities,
    providerResourceId: 'provider_01',
    type: 'provider.opened',
  },
  'provider.open_failed': { ...failed, type: 'provider.open_failed' },
  'provider.open_timed_out': { ...failed, type: 'provider.open_timed_out' },
  'event.applied': { ...base, result: { state: 'appended' }, type: 'event.applied' },
  'event.failed': { ...failed, type: 'event.failed' },
  'event.timed_out_then_applied': {
    ...base,
    result: { state: 'appended' },
    type: 'event.timed_out_then_applied',
  },
  'event.timed_out_then_failed': { ...failed, type: 'event.timed_out_then_failed' },
  'event.unknown': { ...failed, type: 'event.unknown' },
  'persistence.applied': { ...base, result: { state: 'applied' }, type: 'persistence.applied' },
  'persistence.failed': { ...failed, type: 'persistence.failed' },
  'persistence.late_applied': {
    ...base,
    result: { state: 'not_owner' },
    type: 'persistence.late_applied',
  },
  'persistence.late_failed': { ...failed, type: 'persistence.late_failed' },
  'persistence.unknown': { ...failed, type: 'persistence.unknown' },
  'provider.prompt.accepted': { ...turnBase, type: 'provider.prompt.accepted' },
  'provider.prompt.completed': {
    ...turnBase,
    outcome: { status: 'completed' },
    type: 'provider.prompt.completed',
  },
  'provider.prompt.rejected': { ...turnFailed, type: 'provider.prompt.rejected' },
  'provider.prompt.failed': { ...turnFailed, type: 'provider.prompt.failed' },
  'provider.prompt.timed_out': { ...turnFailed, type: 'provider.prompt.timed_out' },
  'provider.interaction.accepted': { ...base, type: 'provider.interaction.accepted' },
  'provider.interaction.rejected': { ...failed, type: 'provider.interaction.rejected' },
  'provider.interaction.failed': { ...failed, type: 'provider.interaction.failed' },
  'provider.interaction.timed_out': { ...failed, type: 'provider.interaction.timed_out' },
  'checkpoint.captured': {
    ...base,
    checkpoint: continuation,
    kind: 'checkpoint',
    type: 'checkpoint.captured',
  },
  'checkpoint.unsupported': { ...failed, type: 'checkpoint.unsupported' },
  'checkpoint.failed': { ...failed, type: 'checkpoint.failed' },
  'checkpoint.timed_out': { ...failed, type: 'checkpoint.timed_out' },
  'process.cleanup.confirmed': { ...base, type: 'process.cleanup.confirmed' },
  'process.cleanup.uncertain': { ...failed, type: 'process.cleanup.uncertain' },
  'output.published': {
    ...base,
    output: {
      files: {
        directory: '/output',
        manifest: 'session.json',
        stderr: 'stderr.log',
        stdout: 'stdout.log',
      },
      state: 'published',
    },
    type: 'output.published',
  },
  'output.failed': {
    ...base,
    output: { error: fault, files: { directory: '/output' }, state: 'failed' },
    type: 'output.failed',
  },
  'output.uncertain': {
    ...base,
    output: { error: fault, files: { directory: '/output' }, state: 'uncertain' },
    type: 'output.uncertain',
  },
} satisfies OutcomeByType;

const hibernationCapture = {
  ...base,
  kind: 'hibernate',
  resumeToken,
  type: 'checkpoint.captured',
} satisfies Extract<EffectOutcomeCommand, { readonly type: 'checkpoint.captured' }>;

void outcomes;
void hibernationCapture;
