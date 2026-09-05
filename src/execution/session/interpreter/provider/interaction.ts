import type { AgentFault } from '../../../../contracts/manager.js';
import type { SessionProtocolInteractionOutcome } from '../../../../protocol/session/model/outcome.js';
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

type InteractionEffect = Extract<SessionEffect, { readonly type: 'provider.interaction.respond' }>;

interface InteractionOptions {
  readonly clock: SessionObservationClock;
  readonly resources: SessionInterpreterResources;
  readonly timer?: SessionOperationTimer;
}

export const createProviderInteractionInterpreter = (
  options: InteractionOptions,
): SessionEffectHandler<'provider.interaction.respond'> => ({
  type: 'provider.interaction.respond',
  execute: (candidate, output): void => {
    if (candidate.type !== 'provider.interaction.respond') return;
    void deliverInteraction(candidate, output, options);
  },
});

const deliverInteraction = async (
  effect: InteractionEffect,
  output: SessionEffectOutput,
  options: InteractionOptions,
): Promise<void> => {
  const endpoint =
    options.resources.providers.get(effect.providerResourceId)?.session ??
    options.resources.providerOpenings.get(effect.providerResourceId);
  if (endpoint === undefined) {
    emit(effect, output, options, 'failed');
    return;
  }
  const operation: Promise<SessionProtocolInteractionOutcome> = Promise.resolve().then(() =>
    endpoint.respond({
      requestId: effect.request.requestId,
      response: effect.response,
    }),
  );
  const settlement = await settleOperation({
    onTimeout: () => undefined,
    operation,
    timeoutMs: effect.timeoutMs,
    timer: options.timer ?? systemSessionOperationTimer,
  });
  if (settlement.state === 'unknown' || settlement.phase === 'late') {
    emit(effect, output, options, 'timed_out');
    return;
  }
  if (settlement.state === 'rejected') {
    emit(effect, output, options, 'failed');
    return;
  }
  if (settlement.value.status === 'accepted') {
    emit(effect, output, options, 'accepted');
    return;
  }
  emit(effect, output, options, settlement.value.status, settlement.value.failure);
};

const emit = (
  effect: InteractionEffect,
  output: SessionEffectOutput,
  options: InteractionOptions,
  status: 'accepted' | 'rejected' | 'failed' | 'timed_out',
  failure?: Parameters<typeof protocolFault>[0],
): void => {
  const now = options.clock.now();
  const base = {
    correlation: effect.correlation,
    observedAt: now.iso,
    observedAtMs: now.milliseconds,
  } as const;
  if (status === 'accepted') {
    output.outcome({ ...base, type: 'provider.interaction.accepted' });
    return;
  }
  const phase = effect.scope.kind === 'opening' ? 'session_opening' : 'session_running';
  const fault: AgentFault =
    status === 'timed_out'
      ? {
          code: 'revo.agent.timeout',
          message: 'Provider interaction delivery timed out.',
          phase,
          retryable: false,
        }
      : protocolFault(failure, phase);
  output.outcome({ ...base, fault, type: `provider.interaction.${status}` });
};
