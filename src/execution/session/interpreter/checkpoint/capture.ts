import type { AgentFault } from '../../../../contracts/manager/core.js';
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
type CaptureFailureStatus = 'unsupported' | 'failed' | 'timed_out' | 'invalid';

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
  const operation: Promise<SessionProtocolCheckpointOutcome> = Promise.resolve().then(() =>
    provider.session.checkpoint(),
  );
  const settlement = await settleOperation({
    onTimeout: () => undefined,
    operation,
    timeoutMs: effect.timeoutMs,
    timer: options.timer ?? systemSessionOperationTimer,
  });
  if (settlement.state === 'unknown' || settlement.phase === 'late') {
    emitFailure(effect, output, options, 'timed_out');
    return;
  }
  if (settlement.state === 'rejected') {
    emitFailure(effect, output, options, 'failed');
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
  status: CaptureFailureStatus,
  failure?: Parameters<typeof protocolFault>[0],
): void => {
  const fault = captureFault(status, failure);
  const now = options.clock.now();
  output.outcome({
    correlation: effect.correlation,
    fault,
    observedAt: now.iso,
    observedAtMs: now.milliseconds,
    type: captureFailureType(status),
  });
};

const captureFault = (
  status: CaptureFailureStatus,
  failure?: Parameters<typeof protocolFault>[0],
): AgentFault => {
  if (status === 'failed') return protocolFault(failure, 'session_checkpointing');
  const details = {
    invalid: ['revo.agent.checkpoint_invalid', 'Provider continuation is invalid.'],
    timed_out: ['revo.agent.timeout', 'Checkpoint capture timed out.'],
    unsupported: [
      'revo.agent.checkpoint_unsupported',
      'Provider checkpoint capture is unsupported.',
    ],
  } as const;
  const [code, message] = details[status];
  return { code, message, phase: 'session_checkpointing', retryable: false };
};

const captureFailureType = (
  status: CaptureFailureStatus,
): 'checkpoint.unsupported' | 'checkpoint.timed_out' | 'checkpoint.failed' => {
  if (status === 'unsupported') return 'checkpoint.unsupported';
  if (status === 'timed_out') return 'checkpoint.timed_out';
  return 'checkpoint.failed';
};
