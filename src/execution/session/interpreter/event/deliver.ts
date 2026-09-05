import type { AgentFault } from '../../../../contracts/manager/core.js';
import type { AgentSessionEventSink } from '../../../../contracts/session/events/sink.js';
import type { SessionEffect } from '../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from '../../runtime/effects/outcomes.js';
import type { SessionEffectHandler } from '../shared/effect/handler.js';
import { settleOperation } from '../shared/operation/settlement.js';
import {
  systemSessionOperationTimer,
  type SessionOperationTimer,
} from '../shared/operation/timer.js';
import { redactSessionValue } from '../shared/value/redacted.js';
import { snapshotSessionEvent } from './encode.js';

interface EventDeliveryClock {
  now(): { readonly iso: string; readonly milliseconds: number };
}

const deliveryFault = (): AgentFault => ({
  code: 'revo.agent.event_sink_failed',
  message: 'The session event could not be durably appended.',
  phase: 'session_delivery',
  retryable: false,
});

export const createEventAppendInterpreter = (options: {
  readonly sink: AgentSessionEventSink;
  readonly clock: EventDeliveryClock;
  readonly timer?: SessionOperationTimer;
  readonly secrets?: (correlation: EventAppendEffect['correlation']) => readonly string[];
}): SessionEffectHandler<'event.append'> => ({
  type: 'event.append',
  execute: (candidate, output): void => {
    if (candidate.type !== 'event.append') return;
    void deliverEvent(candidate, output, options);
  },
});

type EventAppendEffect = Extract<SessionEffect, { readonly type: 'event.append' }>;

const deliverEvent = async (
  effect: EventAppendEffect,
  output: SessionEffectOutput,
  options: {
    readonly sink: AgentSessionEventSink;
    readonly clock: EventDeliveryClock;
    readonly timer?: SessionOperationTimer;
    readonly secrets?: (correlation: EventAppendEffect['correlation']) => readonly string[];
  },
): Promise<void> => {
  const controller = new AbortController();
  let operation: ReturnType<AgentSessionEventSink['append']>;
  try {
    const secrets = effect.redactionSecrets ?? options.secrets?.(effect.correlation) ?? [];
    const event = redactSessionValue(effect.event, secrets);
    operation = options.sink.append(snapshotSessionEvent(event, effect.maxBytes), {
      expected: redactSessionValue(effect.expected, secrets),
      signal: controller.signal,
    });
  } catch {
    operation = Promise.reject(new Error('Session event append failed synchronously.'));
  }
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
  if (settlement.state === 'unknown') {
    output.outcome({ ...base, fault: deliveryFault(), type: 'event.unknown' });
    return;
  }
  if (settlement.state === 'rejected') {
    output.outcome({
      ...base,
      fault: deliveryFault(),
      type: settlement.phase === 'initial' ? 'event.failed' : 'event.timed_out_then_failed',
    });
    return;
  }
  output.outcome({
    ...base,
    result: settlement.value,
    type: settlement.phase === 'initial' ? 'event.applied' : 'event.timed_out_then_applied',
  });
};
