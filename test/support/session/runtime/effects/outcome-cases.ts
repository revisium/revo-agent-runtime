import type { EffectOutcomeCommand } from '../../../../../src/execution/session/kernel/command/effect.js';
import type { InterpretedSessionEffect } from '../../../../../src/execution/session/runtime/effects/dispatcher.js';
import { permissionInteractionRequest } from '../../builders/kernel/interactions.js';
import {
  sessionCapabilities,
  sessionOpeningCommand,
  sessionProcess,
} from '../../builders/kernel/opening.js';
import { idleSessionState } from '../../builders/kernel/session-state.js';

const observed = { observedAt: '2026-09-05T00:00:00.000Z', observedAtMs: 1_000 } as const;
const correlation = (effectId: string) => ({ effectId, epoch: 1, sessionId: 'session_01' });
const turnCorrelation = (effectId: string) => ({
  ...correlation(effectId),
  turnId: 'turn_01',
});
const state = idleSessionState();
const cursor = { eventId: 'event_01', sequence: 1, streamId: state.streamId } as const;
const checkpoint = {
  checkpointId: 'checkpoint_01',
  cursor,
  eligibility: 'observation_only',
  payload: 'opaque',
  pin: state.pin,
  schemaVersion: 'agent-session-checkpoint/v1',
  sessionId: state.sessionId,
  sha256: 'checkpoint-sha256',
} as const;

interface OutcomeCase {
  readonly label: string;
  readonly effect: InterpretedSessionEffect;
  readonly outcome: EffectOutcomeCommand;
}

export const mandatoryOutcomeCases: readonly OutcomeCase[] = [
  {
    effect: {
      correlation: correlation('prepare'),
      opening: sessionOpeningCommand().opening,
      timeoutMs: 100,
      type: 'opening.prepare',
    },
    label: 'preflight and output preparation',
    outcome: {
      ...observed,
      correlation: correlation('prepare'),
      preparationId: 'preparation_01',
      type: 'opening.preparation.succeeded',
    },
  },
  {
    effect: {
      correlation: correlation('process'),
      preparationId: 'preparation_01',
      timeoutMs: 100,
      type: 'process.start',
    },
    label: 'process start',
    outcome: {
      ...observed,
      correlation: correlation('process'),
      process: sessionProcess,
      processResourceId: 'process_01',
      type: 'process.started',
    },
  },
  {
    effect: {
      correlation: correlation('provider_open'),
      preparationId: 'preparation_01',
      processResourceId: 'process_01',
      timeoutMs: 100,
      type: 'provider.open',
    },
    label: 'provider open',
    outcome: {
      ...observed,
      capabilities: sessionCapabilities,
      correlation: correlation('provider_open'),
      providerResourceId: 'provider_01',
      type: 'provider.opened',
    },
  },
  {
    effect: {
      correlation: correlation('event'),
      event: {
        eventId: 'event_01',
        message: 'progress',
        observedAt: observed.observedAt,
        schemaVersion: 'agent-session-event/v1',
        sequence: 1,
        sessionId: state.sessionId,
        streamId: state.streamId,
        turnId: 'turn_01',
        type: 'agent.progress',
      },
      expected: { kind: 'empty' },
      maxBytes: 1_024,
      timeoutMs: 100,
      type: 'event.append',
    },
    label: 'event append',
    outcome: {
      ...observed,
      correlation: correlation('event'),
      result: { state: 'appended' },
      type: 'event.applied',
    },
  },
  {
    effect: {
      correlation: correlation('persistence'),
      snapshot: {
        acceptedAt: state.acceptedAt,
        incarnationId: state.incarnationId,
        pin: state.pin,
        process: sessionProcess,
        sessionId: state.sessionId,
        state: 'idle',
      },
      timeoutMs: 100,
      type: 'persistence.save',
    },
    label: 'persistence mutation',
    outcome: {
      ...observed,
      correlation: correlation('persistence'),
      result: { state: 'applied' },
      type: 'persistence.applied',
    },
  },
  {
    effect: {
      correlation: turnCorrelation('prompt'),
      input: { prompt: 'continue', turnId: 'turn_01' },
      providerResourceId: 'provider_01',
      timeoutMs: 100,
      type: 'provider.prompt',
    },
    label: 'provider prompt',
    outcome: {
      ...observed,
      correlation: turnCorrelation('prompt'),
      outcome: { status: 'cancelled' },
      type: 'provider.prompt.completed',
    },
  },
  {
    effect: {
      correlation: correlation('interaction'),
      providerResourceId: 'provider_01',
      request: permissionInteractionRequest,
      response: { kind: 'permission', outcome: 'denied' },
      scope: { kind: 'turn', turnId: 'turn_01' },
      timeoutMs: 100,
      type: 'provider.interaction.respond',
    },
    label: 'interaction response',
    outcome: {
      ...observed,
      correlation: correlation('interaction'),
      type: 'provider.interaction.accepted',
    },
  },
  {
    effect: {
      checkpointId: 'checkpoint_01',
      correlation: correlation('checkpoint'),
      cursor,
      kind: 'checkpoint',
      maxBytes: 1_024,
      pin: state.pin,
      providerResourceId: 'provider_01',
      timeoutMs: 100,
      type: 'checkpoint.capture',
      usageBaseline: { scope: 'session_cumulative' },
    },
    label: 'checkpoint capture',
    outcome: {
      ...observed,
      checkpoint,
      correlation: correlation('checkpoint'),
      kind: 'checkpoint',
      type: 'checkpoint.captured',
    },
  },
  {
    effect: {
      correlation: correlation('cleanup'),
      process: sessionProcess,
      processResourceId: 'process_01',
      timeoutMs: 100,
      type: 'process.cleanup',
    },
    label: 'process cleanup',
    outcome: {
      ...observed,
      correlation: correlation('cleanup'),
      type: 'process.cleanup.confirmed',
    },
  },
  {
    effect: {
      correlation: correlation('publication'),
      maxBytes: 1_024,
      outputDirectory: '/output',
      publication: {
        acceptedAt: state.acceptedAt,
        cursor,
        finishedAt: observed.observedAt,
        openedAt: state.openedAt,
        pin: state.pin,
        sessionId: state.sessionId,
        status: 'closed',
      },
      type: 'output.publish',
    },
    label: 'output publication',
    outcome: {
      ...observed,
      correlation: correlation('publication'),
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
  },
];
