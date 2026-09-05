import type { AgentFault } from '../../../../../contracts/manager.js';
import type { SessionEffect } from '../../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from '../../../runtime/effects/outcomes.js';
import type { SessionRuntimeIdentitySource } from '../../../runtime/primitives/identity.js';
import { SessionOutputCollector } from '../../output/collect.js';
import type { SessionEffectHandler } from '../../shared/effect/handler.js';
import type { SessionObservationClock } from '../../shared/observation/clock.js';
import { settleOperation } from '../../shared/operation/settlement.js';
import {
  systemSessionOperationTimer,
  type SessionOperationTimer,
} from '../../shared/operation/timer.js';
import type { SessionOpeningPreparer } from './preparation.js';
import type { SessionInterpreterResources } from './resources.js';

type PreparationEffect = Extract<SessionEffect, { readonly type: 'opening.prepare' }>;

const preparationFault = (timedOut: boolean): AgentFault => ({
  code: timedOut ? 'revo.agent.timeout' : 'revo.agent.protocol_failed',
  message: timedOut
    ? 'Session opening preparation timed out.'
    : 'Session opening preparation failed.',
  phase: 'session_opening',
  retryable: false,
});

export const createOpeningPreparationInterpreter = (options: {
  readonly clock: SessionObservationClock;
  readonly identities: SessionRuntimeIdentitySource;
  readonly preparer: SessionOpeningPreparer;
  readonly resources: SessionInterpreterResources;
  readonly timer?: SessionOperationTimer;
}): SessionEffectHandler<'opening.prepare'> => ({
  type: 'opening.prepare',
  execute: (candidate, output): void => {
    if (candidate.type !== 'opening.prepare') return;
    void prepareOpening(candidate, output, options);
  },
});

const prepareOpening = async (
  effect: PreparationEffect,
  output: SessionEffectOutput,
  options: {
    readonly clock: SessionObservationClock;
    readonly identities: SessionRuntimeIdentitySource;
    readonly preparer: SessionOpeningPreparer;
    readonly resources: SessionInterpreterResources;
    readonly timer?: SessionOperationTimer;
  },
): Promise<void> => {
  const controller = new AbortController();
  const operation: ReturnType<SessionOpeningPreparer['prepare']> = Promise.resolve().then(() =>
    options.preparer.prepare(effect.opening, { signal: controller.signal }),
  );
  const settlement = await settleOperation({
    onTimeout: () => controller.abort(),
    operation,
    timeoutMs: effect.timeoutMs,
    timer: options.timer ?? systemSessionOperationTimer,
  });
  const observed = options.clock.now();
  const base = {
    correlation: effect.correlation,
    observedAt: observed.iso,
    observedAtMs: observed.milliseconds,
  } as const;
  if (settlement.state !== 'fulfilled' || settlement.phase !== 'initial') {
    output.outcome({
      ...base,
      fault: preparationFault(settlement.state === 'unknown' || settlement.phase === 'late'),
      type:
        settlement.state === 'unknown' || settlement.phase === 'late'
          ? 'opening.preparation.timed_out'
          : 'opening.preparation.failed',
    });
    return;
  }
  if (settlement.value.status === 'rejected') {
    output.outcome({
      ...base,
      fault: settlement.value.fault,
      type: 'opening.preparation.rejected',
    });
    return;
  }
  const preparationId = options.identities.next('preparation');
  const secrets = Object.values(effect.opening.environment?.secrets ?? {});
  const registered = options.resources.preparations.register(preparationId, {
    correlation: effect.correlation,
    opening: effect.opening,
    output: new SessionOutputCollector(effect.opening.limits.maxOutputBytes, secrets),
    prepared: settlement.value.value,
  });
  if (!registered) {
    output.outcome({ ...base, fault: preparationFault(false), type: 'opening.preparation.failed' });
    return;
  }
  output.outcome({ ...base, preparationId, type: 'opening.preparation.succeeded' });
};
