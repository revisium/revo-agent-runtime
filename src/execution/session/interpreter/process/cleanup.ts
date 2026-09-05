import type { AgentFault } from '../../../../contracts/manager.js';
import type { ActiveProcessIdentity } from '../../../../contracts/manager/core.js';
import type { ProcessCleanupOutcome } from '../../../process/port.js';
import type { SessionEffect } from '../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from '../../runtime/effects/outcomes.js';
import type { SessionInterpreterResources } from '../provider/opening/resources.js';
import type { SessionEffectHandler } from '../shared/effect/handler.js';
import type { SessionObservationClock } from '../shared/observation/clock.js';
import { settleOperation } from '../shared/operation/settlement.js';
import {
  systemSessionOperationTimer,
  type SessionOperationTimer,
} from '../shared/operation/timer.js';

type CleanupEffect = Extract<SessionEffect, { readonly type: 'process.cleanup' }>;

interface CleanupOptions {
  readonly clock: SessionObservationClock;
  readonly resources: SessionInterpreterResources;
  readonly timer?: SessionOperationTimer;
}

const sameIdentity = (left: ActiveProcessIdentity, right: ActiveProcessIdentity): boolean =>
  left.pid === right.pid &&
  left.processGroupId === right.processGroupId &&
  left.fingerprint === right.fingerprint &&
  left.startedAt === right.startedAt;

export const createProcessCleanupInterpreter = (
  options: CleanupOptions,
): SessionEffectHandler<'process.cleanup'> => ({
  type: 'process.cleanup',
  execute: (candidate, output): void => {
    if (candidate.type === 'process.cleanup') void cleanup(candidate, output, options);
  },
});

const cleanup = async (
  effect: CleanupEffect,
  output: SessionEffectOutput,
  options: CleanupOptions,
): Promise<void> => {
  const process = options.resources.processes.take(effect.processResourceId);
  if (process === undefined) {
    emit(effect, output, options, false);
    return;
  }
  if (!sameIdentity(process.identity, effect.process)) {
    options.resources.processes.register(effect.processResourceId, process);
    emit(effect, output, options, false);
    return;
  }
  const operation: Promise<ProcessCleanupOutcome> = Promise.resolve().then(() =>
    process.terminateAndReap(),
  );
  const settlement = await settleOperation({
    onTimeout: () => undefined,
    operation,
    timeoutMs: effect.timeoutMs,
    timer: options.timer ?? systemSessionOperationTimer,
  });
  emit(
    effect,
    output,
    options,
    settlement.state === 'fulfilled' &&
      settlement.phase === 'initial' &&
      settlement.value.status === 'confirmed',
  );
};

const emit = (
  effect: CleanupEffect,
  output: SessionEffectOutput,
  options: CleanupOptions,
  confirmed: boolean,
): void => {
  const now = options.clock.now();
  const base = {
    correlation: effect.correlation,
    observedAt: now.iso,
    observedAtMs: now.milliseconds,
  } as const;
  if (confirmed) {
    output.outcome({ ...base, type: 'process.cleanup.confirmed' });
    return;
  }
  const fault: AgentFault = {
    code: 'revo.agent.process_cleanup_failed',
    message: 'Session process cleanup could not be confirmed.',
    phase: 'session_terminal',
    retryable: false,
  };
  output.outcome({ ...base, fault, type: 'process.cleanup.uncertain' });
};
