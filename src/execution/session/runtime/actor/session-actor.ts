import type { PublicSessionCommand } from '../../kernel/command/public.js';
import type { SessionCommand } from '../../kernel/command/session-command.js';
import type { SessionEffect } from '../../kernel/effect/session-effect.js';
import type { SessionState } from '../../kernel/model/session-state.js';
import type { SessionReducer } from '../../kernel/reducer/transition.js';
import { PublicCallRegistry, type PublicCallSettlement } from '../calls/registry.js';
import { SessionEffectDispatcher } from '../effects/dispatcher.js';
import type { ProviderUpdateCompletion } from '../effects/outcomes.js';
import {
  failedEffectOutcome,
  isTerminalEffectOutcome,
  SessionEffectOutputController,
} from '../effects/router.js';
import { EffectTracker } from '../effects/tracker.js';
import {
  commandAdmission,
  isEffectOutcomeCommand,
  MAX_QUEUED_EVENTS,
  OutcomeCreditLedger,
  requiresOutcomeCredit,
} from '../mailbox/credits.js';
import { SerializedMailboxDrain } from '../mailbox/drain.js';
import { SessionMailboxQueue } from '../mailbox/queue.js';
import { ownsProviderResource } from '../resources/provider-openings.js';
import type { SessionClock } from '../timing/clock.js';
import { SessionTimerRegistry } from '../timing/timers.js';

interface ActorEnvelope {
  readonly command: SessionCommand;
  readonly complete?: (result: ProviderUpdateCompletion) => void;
}

export interface SessionActorOptions {
  readonly initialState: SessionState;
  readonly reducer: SessionReducer;
  readonly dispatcher: SessionEffectDispatcher;
  readonly clock: SessionClock;
}

type AgentFault = Extract<SessionEffect, { readonly type: 'public.reject' }>['fault'];

export type SessionDispatchResult =
  | { readonly state: 'accepted' | 'coalesced' }
  | { readonly state: 'rejected'; readonly fault: AgentFault };

const backpressureFault = (state: SessionState): AgentFault => ({
  code: 'revo.agent.session_backpressure',
  message: 'The session mailbox admission budget is exhausted.',
  phase: state.status === 'opening' ? 'session_opening' : 'session_running',
  retryable: true,
});

export class SessionActor {
  readonly #queue = new SessionMailboxQueue<ActorEnvelope>();
  readonly #credits = new OutcomeCreditLedger();
  readonly #tracker = new EffectTracker();
  readonly #calls = new PublicCallRegistry();
  readonly #drain: SerializedMailboxDrain<ActorEnvelope>;
  readonly #timers: SessionTimerRegistry;
  readonly #output: SessionEffectOutputController;
  #state: SessionState;

  constructor(private readonly options: SessionActorOptions) {
    this.#state = options.initialState;
    this.#drain = new SerializedMailboxDrain(this.#queue, (envelope) => this.#consume(envelope));
    this.#timers = new SessionTimerRegistry(options.clock, (command) => this.#enqueue({ command }));
    this.#output = new SessionEffectOutputController(
      options.clock,
      (command, complete) =>
        this.#enqueue({ command, ...(complete === undefined ? {} : { complete }) }),
      MAX_QUEUED_EVENTS,
    );
    this.#timers.reconcile(this.#state);
  }

  get state(): SessionState {
    return this.#state;
  }

  get activeEffects(): number {
    return this.#tracker.size;
  }

  registerCall(callId: string): Promise<PublicCallSettlement> {
    return this.#calls.register(callId);
  }

  dispatch(command: PublicSessionCommand): SessionDispatchResult {
    const admission = this.#enqueue({ command });
    if (admission === 'rejected') {
      const fault = backpressureFault(this.#state);
      this.#calls.reject(command.call.callId, fault);
      if (command.type === 'turn.send') this.#calls.reject(command.resultCallId, fault);
      return { fault, state: 'rejected' };
    }
    return { state: admission };
  }

  async whenQuiescent(): Promise<void> {
    this.#drain.run();
    if (
      this.#queue.size === 0 &&
      this.#tracker.size === 0 &&
      this.#calls.size === 0 &&
      this.#output.blockedUpdates === 0
    )
      return;
    await Promise.all([this.#tracker.whenIdle(), this.#calls.whenEmpty()]);
    return this.whenQuiescent();
  }

  #enqueue(envelope: ActorEnvelope): 'accepted' | 'coalesced' | 'rejected' {
    const admission = this.#queue.admit(envelope, commandAdmission(envelope.command));
    if (admission.state === 'coalesced')
      this.#aliasControl(envelope.command, admission.leader.command);
    if (admission.state === 'accepted') this.#drain.run();
    return admission.state;
  }

  #aliasControl(follower: SessionCommand, leader: SessionCommand): void {
    if (!('call' in follower) || !('call' in leader)) return;
    this.#calls.alias(follower.call.callId, leader.call.callId);
  }

  #consume(envelope: ActorEnvelope): void {
    const previous = this.#state;
    const transition = this.options.reducer(previous, envelope.command);
    if (isEffectOutcomeCommand(envelope.command)) this.#finishOutcome(envelope.command);
    if (!this.#credits.reserve(transition.effects)) {
      this.#state = transition.state;
      this.#timers.cancelAll();
      this.#failEffects(transition.effects);
      this.#output.completeUpdate(
        envelope.complete,
        'processed',
        this.#state.events.pending.length,
      );
      this.#output.releaseBlocked(this.#state.events.pending.length);
      return;
    }
    this.#state = transition.state;
    this.#timers.reconcile(this.#state);
    this.#dispatchEffects(transition.effects);
    this.#cleanupLateProvider(envelope.command);
    const changed = transition.state !== previous || transition.effects.length > 0;
    this.#output.completeUpdate(
      envelope.complete,
      changed ? 'processed' : 'stale',
      this.#state.events.pending.length,
    );
    this.#output.releaseBlocked(this.#state.events.pending.length);
  }

  #finishOutcome(command: SessionCommand): void {
    if (!isEffectOutcomeCommand(command) || !isTerminalEffectOutcome(command)) return;
    if (this.#credits.release(command)) this.#tracker.finish(command.correlation.effectId);
  }

  #dispatchEffects(effects: readonly SessionEffect[]): void {
    for (const effect of effects) {
      if (effect.type === 'public.resolve') {
        this.#calls.resolve(effect.callId, effect.resolution);
        continue;
      }
      if (effect.type === 'public.reject') {
        this.#calls.reject(effect.callId, effect.fault);
        continue;
      }
      if (effect.type === 'timer.schedule' || effect.type === 'timer.cancel') continue;
      if (requiresOutcomeCredit(effect)) this.#tracker.begin(effect.correlation.effectId);
      try {
        if (!this.options.dispatcher.dispatch(effect, this.#output)) this.#failEffects([effect]);
      } catch {
        this.#failEffects([effect]);
      }
    }
  }

  #failEffects(effects: readonly SessionEffect[]): void {
    const effect = effects.find(requiresOutcomeCredit);
    if (effect === undefined) return;
    const fault: AgentFault = {
      code: 'revo.agent.session_backpressure',
      message: 'A mandatory session effect could not be started safely.',
      phase: 'session_terminal',
      retryable: false,
    };
    const outcome = failedEffectOutcome(effect, this.options.clock.now(), fault);
    if (outcome !== undefined) this.#enqueue({ command: outcome });
  }

  #cleanupLateProvider(command: SessionCommand): void {
    if (
      command.type !== 'provider.opened' ||
      ownsProviderResource(this.#state, command.providerResourceId)
    )
      return;
    this.options.dispatcher.dispatch(
      {
        correlation: command.correlation,
        providerResourceId: command.providerResourceId,
        reason: 'Late provider opening was not admitted by the current session incarnation.',
        timeoutMs: this.#state.limits.operationTimeoutMs,
        type: 'provider.close',
      },
      this.#output,
    );
  }
}
