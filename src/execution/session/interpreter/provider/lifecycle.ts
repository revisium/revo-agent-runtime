import type { SessionProtocolCancellationOutcome } from '../../../../protocol/session/model/outcome.js';
import type { SessionEffect } from '../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from '../../runtime/effects/outcomes.js';
import type { SessionEffectHandler } from '../shared/effect/handler.js';
import type { SessionObservationClock } from '../shared/observation/clock.js';
import { settleOperation } from '../shared/operation/settlement.js';
import {
  systemSessionOperationTimer,
  type SessionOperationTimer,
} from '../shared/operation/timer.js';
import { protocolFault } from './fault.js';
import type { SessionInterpreterResources } from './opening/resources.js';

type CancelEffect = Extract<SessionEffect, { readonly type: 'provider.turn.cancel' }>;
type CloseEffect = Extract<SessionEffect, { readonly type: 'provider.close' }>;

interface LifecycleOptions {
  readonly clock: SessionObservationClock;
  readonly resources: SessionInterpreterResources;
  readonly timer?: SessionOperationTimer;
}

export const createProviderLifecycleInterpreters = (
  options: LifecycleOptions,
): readonly SessionEffectHandler<'provider.turn.cancel' | 'provider.close'>[] => [
  {
    type: 'provider.turn.cancel',
    execute: (candidate, output): void => {
      if (candidate.type === 'provider.turn.cancel') void cancelTurn(candidate, output, options);
    },
  },
  {
    type: 'provider.close',
    execute: (candidate): void => {
      if (candidate.type === 'provider.close') void closeProvider(candidate, options);
    },
  },
];

const cancelTurn = async (
  effect: CancelEffect,
  output: SessionEffectOutput,
  options: LifecycleOptions,
): Promise<void> => {
  const resource = options.resources.prompts.markCancelling(
    effect.providerResourceId,
    effect.turnId,
  );
  if (resource === undefined) {
    emitCancellationFailure(effect, output, options, false);
    return;
  }
  const operation: Promise<SessionProtocolCancellationOutcome> = Promise.resolve().then(
    async () => {
      const requested = await resource.prompt.cancel(effect.reason);
      if (requested.status !== 'requested') return requested;
      await Promise.race([resource.prompt.completion, resource.stopped]);
      return requested;
    },
  );
  const settlement = await settleOperation({
    onTimeout: () => undefined,
    operation,
    timeoutMs: effect.timeoutMs,
    timer: options.timer ?? systemSessionOperationTimer,
  });
  if (
    settlement.state !== 'fulfilled' ||
    settlement.phase !== 'initial' ||
    settlement.value.status !== 'requested'
  ) {
    emitCancellationFailure(
      effect,
      output,
      options,
      settlement.state === 'unknown' || settlement.phase === 'late',
      settlement.state === 'fulfilled' && settlement.value.status === 'failed'
        ? settlement.value.failure
        : undefined,
    );
    return;
  }
};

const emitCancellationFailure = (
  effect: CancelEffect,
  output: SessionEffectOutput,
  options: LifecycleOptions,
  timedOut: boolean,
  failure?: Parameters<typeof protocolFault>[0],
): void => {
  const now = options.clock.now();
  output.outcome({
    correlation: effect.correlation,
    fault: timedOut
      ? {
          code: 'revo.agent.timeout',
          message: 'Provider prompt cancellation timed out.',
          phase: 'session_running',
          retryable: false,
        }
      : protocolFault(failure, 'session_running'),
    observedAt: now.iso,
    observedAtMs: now.milliseconds,
    type: timedOut ? 'provider.prompt.timed_out' : 'provider.prompt.failed',
  });
};

const closeProvider = async (effect: CloseEffect, options: LifecycleOptions): Promise<void> => {
  for (const resource of options.resources.prompts.takeProvider(effect.providerResourceId)) {
    if (resource.cancellationRequested) continue;
    void Promise.resolve()
      .then(() => resource.prompt.cancel(effect.reason))
      .catch(() => undefined);
  }
  const endpoint =
    options.resources.providers.take(effect.providerResourceId)?.session ??
    options.resources.providerOpenings.takeByResourceId(effect.providerResourceId);
  if (endpoint === undefined) return;
  const operation = Promise.resolve().then(() => endpoint.close(effect.reason));
  await settleOperation({
    onTimeout: () => undefined,
    operation,
    timeoutMs: effect.timeoutMs,
    timer: options.timer ?? systemSessionOperationTimer,
  });
};
