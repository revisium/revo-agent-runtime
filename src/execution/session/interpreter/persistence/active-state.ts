import type { AgentFault } from '../../../../contracts/manager.js';
import type {
  ActiveAgentSessionStateMutationResult,
  ActiveAgentSessionStateSink,
} from '../../../../contracts/session/persistence/active-state.js';
import type { SessionEffect } from '../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from '../../runtime/effects/outcomes.js';
import type { SessionEffectHandler } from '../shared/effect/handler.js';
import { settleOperation, type OperationSettlement } from '../shared/operation/settlement.js';
import {
  systemSessionOperationTimer,
  type SessionOperationTimer,
} from '../shared/operation/timer.js';

type PersistenceEffect = Extract<SessionEffect, { readonly type: `persistence.${string}` }>;

interface PersistenceClock {
  now(): { readonly iso: string; readonly milliseconds: number };
}

interface StartedMutation {
  readonly classification: Promise<OperationSettlement<ActiveAgentSessionStateMutationResult>>;
  readonly completion: Promise<void>;
}

const persistenceFault = (): AgentFault => ({
  code: 'revo.agent.active_state_failed',
  message: 'The active session state mutation could not be confirmed.',
  phase: 'session_terminal',
  retryable: false,
});

class ActiveStateMutationLane {
  readonly #tails = new Map<string, Promise<void>>();
  readonly #removals = new Map<
    string,
    Promise<OperationSettlement<ActiveAgentSessionStateMutationResult>>
  >();
  readonly #terminal = new Set<string>();

  constructor(
    private readonly sink: ActiveAgentSessionStateSink,
    private readonly timer: SessionOperationTimer,
  ) {}

  execute(effect: PersistenceEffect, output: SessionEffectOutput, clock: PersistenceClock): void {
    const sessionKey = this.#sessionKey(effect);
    if (effect.type === 'persistence.save' && this.#terminal.has(sessionKey)) {
      this.#failed(effect, output, clock);
      return;
    }
    const classification =
      effect.type === 'persistence.remove'
        ? this.#remove(effect, sessionKey)
        : this.#enqueue(effect, sessionKey);
    void classification.then((settlement) => this.#emit(effect, settlement, output, clock));
  }

  #remove(
    effect: Extract<PersistenceEffect, { readonly type: 'persistence.remove' }>,
    sessionKey: string,
  ): Promise<OperationSettlement<ActiveAgentSessionStateMutationResult>> {
    this.#terminal.add(sessionKey);
    const identityKey = `${effect.correlation.sessionId}\0${effect.incarnationId}`;
    const existing = this.#removals.get(identityKey);
    if (existing !== undefined) return existing;
    const classification = this.#enqueue(effect, sessionKey);
    this.#removals.set(identityKey, classification);
    return classification;
  }

  #enqueue(
    effect: PersistenceEffect,
    sessionKey: string,
  ): Promise<OperationSettlement<ActiveAgentSessionStateMutationResult>> {
    const preceding = this.#tails.get(sessionKey) ?? Promise.resolve();
    const started = preceding.then(() => this.#start(effect));
    const tail = started.then(({ completion }) => completion);
    this.#tails.set(sessionKey, tail);
    void tail.finally(() => {
      if (this.#tails.get(sessionKey) === tail) this.#tails.delete(sessionKey);
    });
    return started.then(({ classification }) => classification);
  }

  #start(effect: PersistenceEffect): StartedMutation {
    const controller = new AbortController();
    const operation: Promise<ActiveAgentSessionStateMutationResult> = Promise.resolve().then(() =>
      effect.type === 'persistence.save'
        ? this.sink.save(effect.snapshot, { signal: controller.signal })
        : this.sink.remove(
            {
              incarnationId: effect.incarnationId,
              sessionId: effect.correlation.sessionId,
            },
            { signal: controller.signal },
          ),
    );
    return {
      classification: settleOperation({
        onTimeout: () => controller.abort(),
        operation,
        timeoutMs: effect.timeoutMs,
        timer: this.timer,
      }),
      completion: operation.then(
        () => undefined,
        () => undefined,
      ),
    };
  }

  #emit(
    effect: PersistenceEffect,
    settlement: OperationSettlement<ActiveAgentSessionStateMutationResult>,
    output: SessionEffectOutput,
    clock: PersistenceClock,
  ): void {
    const observed = clock.now();
    const base = {
      correlation: effect.correlation,
      observedAt: observed.iso,
      observedAtMs: observed.milliseconds,
    } as const;
    if (settlement.state === 'unknown') {
      output.outcome({ ...base, fault: persistenceFault(), type: 'persistence.unknown' });
      return;
    }
    if (settlement.state === 'rejected') {
      output.outcome({
        ...base,
        fault: persistenceFault(),
        type: settlement.phase === 'initial' ? 'persistence.failed' : 'persistence.late_failed',
      });
      return;
    }
    output.outcome({
      ...base,
      result: settlement.value,
      type: settlement.phase === 'initial' ? 'persistence.applied' : 'persistence.late_applied',
    });
  }

  #failed(effect: PersistenceEffect, output: SessionEffectOutput, clock: PersistenceClock): void {
    const observed = clock.now();
    output.outcome({
      correlation: effect.correlation,
      fault: persistenceFault(),
      observedAt: observed.iso,
      observedAtMs: observed.milliseconds,
      type: 'persistence.failed',
    });
  }

  #sessionKey(effect: PersistenceEffect): string {
    return `${effect.correlation.sessionId}\0${effect.correlation.epoch}`;
  }
}

export const createActiveStateInterpreters = (options: {
  readonly sink: ActiveAgentSessionStateSink;
  readonly clock: PersistenceClock;
  readonly timer?: SessionOperationTimer;
}): {
  readonly save: SessionEffectHandler<'persistence.save'>;
  readonly remove: SessionEffectHandler<'persistence.remove'>;
} => {
  const lane = new ActiveStateMutationLane(
    options.sink,
    options.timer ?? systemSessionOperationTimer,
  );
  return Object.freeze({
    remove: {
      execute: (effect, output) => {
        if (effect.type === 'persistence.remove') lane.execute(effect, output, options.clock);
      },
      type: 'persistence.remove',
    },
    save: {
      execute: (effect, output) => {
        if (effect.type === 'persistence.save') lane.execute(effect, output, options.clock);
      },
      type: 'persistence.save',
    },
  });
};
