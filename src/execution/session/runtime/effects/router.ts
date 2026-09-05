import type { SessionCommand } from '../../kernel/command/session-command.js';
import type {
  SessionEffect,
  SessionEffectOutcome,
  SessionProviderUpdate,
} from '../../kernel/effect/session-effect.js';
import type { SessionClock } from '../timing/clock.js';
import type {
  ProviderUpdateAdmission,
  ProviderUpdateCompletion,
  SessionEffectOutput,
} from './outcomes.js';

type AgentFault = Extract<SessionEffect, { readonly type: 'public.reject' }>['fault'];
type CommandAdmission = 'accepted' | 'coalesced' | 'rejected';
type UpdateCompletion = (result: ProviderUpdateCompletion) => void;
type EnqueueCommand = (command: SessionCommand, complete?: UpdateCompletion) => CommandAdmission;

export const isTerminalEffectOutcome = (command: SessionEffectOutcome): boolean =>
  command.type !== 'provider.prompt.accepted';

export class SessionEffectOutputController implements SessionEffectOutput {
  readonly #rollingUpdates = new Set<string>();
  readonly #blockedUpdates: Array<{
    readonly complete: UpdateCompletion;
    readonly result: ProviderUpdateCompletion;
  }> = [];

  constructor(
    private readonly clock: SessionClock,
    private readonly enqueue: EnqueueCommand,
    private readonly eventLimit: number,
  ) {}

  get blockedUpdates(): number {
    return this.#blockedUpdates.length;
  }

  outcome(command: SessionEffectOutcome): void {
    this.enqueue(command);
  }

  update(command: SessionProviderUpdate): Promise<ProviderUpdateCompletion> {
    const effectId = command.correlation.effectId;
    if (this.#rollingUpdates.has(effectId)) {
      this.#overflow(command);
      return Promise.resolve('stale');
    }
    this.#rollingUpdates.add(effectId);
    return new Promise((resolve) => {
      const complete = (result: ProviderUpdateCompletion): void => {
        this.#rollingUpdates.delete(effectId);
        resolve(result);
      };
      if (this.enqueue(command, complete) === 'rejected') {
        this.#overflow(command);
        complete('stale');
      }
    });
  }

  offerUpdate(command: SessionProviderUpdate): ProviderUpdateAdmission {
    if (this.enqueue(command) !== 'rejected') return 'accepted';
    this.#overflow(command);
    return 'overflow';
  }

  completeUpdate(
    complete: UpdateCompletion | undefined,
    result: ProviderUpdateCompletion,
    pendingEvents: number,
  ): void {
    if (complete === undefined) return;
    if (result === 'processed' && pendingEvents >= this.eventLimit) {
      this.#blockedUpdates.push({ complete, result });
      return;
    }
    complete(result);
  }

  releaseBlocked(pendingEvents: number): void {
    if (pendingEvents >= this.eventLimit) return;
    const updates = this.#blockedUpdates.splice(0);
    for (const { complete, result } of updates) complete(result);
  }

  #overflow(command: SessionProviderUpdate): void {
    const fault: AgentFault = {
      code: 'revo.agent.session_backpressure',
      message: 'The provider update ingress budget is exhausted.',
      phase: 'session_running',
      retryable: false,
    };
    const observed = this.clock.now();
    const base = {
      correlation: command.correlation,
      fault,
      observedAt: observed.iso,
      observedAtMs: observed.milliseconds,
    } as const;
    if (command.correlation.turnId === undefined) {
      this.enqueue({ ...base, type: 'provider.open_failed' });
      return;
    }
    this.enqueue({
      ...base,
      correlation: { ...command.correlation, turnId: command.correlation.turnId },
      type: 'provider.prompt.failed',
    });
  }
}

// oxlint-disable-next-line typescript/consistent-return -- the checked effect union is exhaustive
export const failedEffectOutcome = (
  effect: SessionEffect,
  observed: ReturnType<SessionClock['now']>,
  fault: AgentFault,
): SessionEffectOutcome | undefined => {
  const base = {
    correlation: effect.correlation,
    observedAt: observed.iso,
    observedAtMs: observed.milliseconds,
  } as const;
  switch (effect.type) {
    case 'opening.prepare':
      return { ...base, fault, type: 'opening.preparation.failed' };
    case 'process.start':
      return { ...base, fault, type: 'process.failed' };
    case 'provider.open':
      return { ...base, fault, type: 'provider.open_failed' };
    case 'provider.prompt':
      return { ...base, correlation: effect.correlation, fault, type: 'provider.prompt.failed' };
    case 'provider.interaction.respond':
      return { ...base, fault, type: 'provider.interaction.failed' };
    case 'event.append':
      return { ...base, fault, type: 'event.failed' };
    case 'persistence.save':
    case 'persistence.remove':
      return { ...base, fault, type: 'persistence.unknown' };
    case 'checkpoint.capture':
      return { ...base, fault, type: 'checkpoint.failed' };
    case 'process.cleanup':
      return { ...base, fault, type: 'process.cleanup.uncertain' };
    case 'output.publish':
      return {
        ...base,
        output: {
          error: fault,
          files: { directory: effect.outputDirectory },
          state: 'uncertain',
        },
        type: 'output.uncertain',
      };
    case 'provider.turn.cancel':
    case 'provider.close':
    case 'timer.schedule':
    case 'timer.cancel':
    case 'public.resolve':
    case 'public.reject':
      return undefined;
  }
};
