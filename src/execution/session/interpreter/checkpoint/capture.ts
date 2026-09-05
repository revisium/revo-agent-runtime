import type { AgentFault } from '../../../../contracts/manager.js';
import type { SessionProtocolCheckpointOutcome } from '../../../../protocol/session/model/outcome.js';
import type { Sha256Digest } from '../../../security/digest/port.js';
import type { SessionEffect } from '../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from '../../runtime/effects/outcomes.js';
import { protocolFault } from '../provider/fault.js';
import type {
  PreparedSessionResource,
  SessionInterpreterResources,
} from '../provider/opening/resources.js';
import type { SessionEffectHandler } from '../shared/effect/handler.js';
import type { SessionObservationClock } from '../shared/observation/clock.js';
import { settleOperation } from '../shared/operation/settlement.js';
import {
  systemSessionOperationTimer,
  type SessionOperationTimer,
} from '../shared/operation/timer.js';
import { digestSessionContinuation, encodeSessionContinuation } from './encode.js';

type CaptureEffect = Extract<SessionEffect, { readonly type: 'checkpoint.capture' }>;

interface CaptureOptions {
  readonly clock: SessionObservationClock;
  readonly digest: Sha256Digest;
  readonly resources: SessionInterpreterResources;
  readonly timer?: SessionOperationTimer;
}

export const createCheckpointCaptureInterpreter = (
  options: CaptureOptions,
): SessionEffectHandler<'checkpoint.capture'> => ({
  type: 'checkpoint.capture',
  execute: (candidate, output): void => {
    if (candidate.type === 'checkpoint.capture') void capture(candidate, output, options);
  },
});

const capture = async (
  effect: CaptureEffect,
  output: SessionEffectOutput,
  options: CaptureOptions,
): Promise<void> => {
  const provider = options.resources.providers.get(effect.providerResourceId);
  if (provider === undefined) {
    emitFailure(effect, output, options, 'failed');
    return;
  }
  let operation: Promise<SessionProtocolCheckpointOutcome>;
  try {
    operation = provider.session.checkpoint();
  } catch {
    emitFailure(effect, output, options, 'failed');
    return;
  }
  const settlement = await settleOperation({
    onTimeout: () => undefined,
    operation,
    timeoutMs: effect.timeoutMs,
    timer: options.timer ?? systemSessionOperationTimer,
  });
  if (settlement.state !== 'fulfilled' || settlement.phase !== 'initial') {
    emitFailure(effect, output, options, 'timed_out');
    return;
  }
  if (settlement.value.status !== 'captured') {
    emitFailure(effect, output, options, settlement.value.status, settlement.value.failure);
    return;
  }
  try {
    emitCaptured(effect, settlement.value.continuation, provider.preparation, output, options);
  } catch {
    emitFailure(effect, output, options, 'invalid');
  }
};

const emitCaptured = (
  effect: CaptureEffect,
  continuation: Extract<
    SessionProtocolCheckpointOutcome,
    { readonly status: 'captured' }
  >['continuation'],
  preparation: PreparedSessionResource,
  output: SessionEffectOutput,
  options: CaptureOptions,
): void => {
  const payload = encodeSessionContinuation({
    continuation,
    maxBytes: effect.maxBytes,
    secrets: Object.values(preparation.opening.environment?.secrets ?? {}),
    usageBaseline: effect.usageBaseline,
  });
  const common = {
    cursor: effect.cursor,
    payload,
    pin: effect.pin,
    sessionId: effect.correlation.sessionId,
  } as const;
  const now = options.clock.now();
  if (effect.kind === 'checkpoint') {
    const value = {
      ...common,
      checkpointId: effect.checkpointId,
      eligibility: 'observation_only' as const,
      schemaVersion: 'agent-session-checkpoint/v1' as const,
    };
    const checkpoint = Object.freeze({
      ...value,
      sha256: digestSessionContinuation(value, options.digest),
    });
    output.outcome({
      checkpoint,
      correlation: effect.correlation,
      kind: 'checkpoint',
      observedAt: now.iso,
      observedAtMs: now.milliseconds,
      type: 'checkpoint.captured',
    });
    return;
  }
  const value = {
    ...common,
    eligibility: 'hibernated' as const,
    resumeTokenId: effect.resumeTokenId,
    schemaVersion: 'agent-session-resume-token/v1' as const,
  };
  const resumeToken = Object.freeze({
    ...value,
    sha256: digestSessionContinuation(value, options.digest),
  });
  output.outcome({
    correlation: effect.correlation,
    kind: 'hibernate',
    observedAt: now.iso,
    observedAtMs: now.milliseconds,
    resumeToken,
    type: 'checkpoint.captured',
  });
};

const emitFailure = (
  effect: CaptureEffect,
  output: SessionEffectOutput,
  options: CaptureOptions,
  status: 'unsupported' | 'failed' | 'timed_out' | 'invalid',
  failure?: Parameters<typeof protocolFault>[0],
): void => {
  const fault: AgentFault =
    status === 'timed_out'
      ? {
          code: 'revo.agent.timeout',
          message: 'Checkpoint capture timed out.',
          phase: 'session_checkpointing',
          retryable: false,
        }
      : status === 'invalid'
        ? {
            code: 'revo.agent.checkpoint_invalid',
            message: 'Provider continuation is invalid.',
            phase: 'session_checkpointing',
            retryable: false,
          }
        : status === 'unsupported'
          ? {
              code: 'revo.agent.checkpoint_unsupported',
              message: 'Provider checkpoint capture is unsupported.',
              phase: 'session_checkpointing',
              retryable: false,
            }
          : protocolFault(failure, 'session_checkpointing');
  const now = options.clock.now();
  output.outcome({
    correlation: effect.correlation,
    fault,
    observedAt: now.iso,
    observedAtMs: now.milliseconds,
    type:
      status === 'unsupported'
        ? 'checkpoint.unsupported'
        : status === 'timed_out'
          ? 'checkpoint.timed_out'
          : 'checkpoint.failed',
  });
};
