import type { EffectOutcomeCommand } from '../../../../src/execution/session/kernel/command/effect.js';
import type { ProviderCommand } from '../../../../src/execution/session/kernel/command/provider.js';
import type { SessionCommand } from '../../../../src/execution/session/kernel/command/session-command.js';
import type { TimerCommand } from '../../../../src/execution/session/kernel/command/timer.js';
import type { SessionEffect } from '../../../../src/execution/session/kernel/effect/session-effect.js';
import type { EffectCorrelation } from '../../../../src/execution/session/kernel/model/identity.js';
import type { SessionState } from '../../../../src/execution/session/kernel/model/session-state.js';
import type {
  SessionReducer,
  SessionTransition,
} from '../../../../src/execution/session/kernel/reducer/transition.js';

declare const reducer: SessionReducer;
declare const state: SessionState;
declare const command: SessionCommand;
declare const effect: SessionEffect;

const transition: SessionTransition = reducer(state, command);
const correlation: EffectCorrelation = effect.correlation;

void transition.state;
void transition.effects;
void correlation.sessionId;
void correlation.epoch;
void correlation.effectId;
void correlation.turnId;

type ExactCorrelationKeys = keyof EffectCorrelation extends
  | 'sessionId'
  | 'epoch'
  | 'effectId'
  | 'turnId'
  ? 'sessionId' | 'epoch' | 'effectId' | 'turnId' extends keyof EffectCorrelation
    ? true
    : false
  : false;

const exactCorrelationKeys: ExactCorrelationKeys = true;
const everyEffectIsCorrelated: SessionEffect extends {
  readonly correlation: EffectCorrelation;
}
  ? true
  : false = true;
const everyOutcomeIsCorrelated: EffectOutcomeCommand extends {
  readonly correlation: EffectCorrelation;
}
  ? true
  : false = true;
const everyProviderCommandIsCorrelated: ProviderCommand extends {
  readonly correlation: EffectCorrelation;
}
  ? true
  : false = true;
const everyTimerCommandIsCorrelated: TimerCommand extends {
  readonly correlation: EffectCorrelation;
}
  ? true
  : false = true;

void exactCorrelationKeys;
void everyEffectIsCorrelated;
void everyOutcomeIsCorrelated;
void everyProviderCommandIsCorrelated;
void everyTimerCommandIsCorrelated;

// @ts-expect-error The reducer is synchronous and never returns a promise.
const asynchronous: Promise<SessionTransition> = reducer(state, command);
void asynchronous;

// @ts-expect-error Every effect has the complete correlation envelope.
const missingCorrelation: SessionEffect = { type: 'timer.cancel', timerId: 'timer_01' };
void missingCorrelation;

// @ts-expect-error Every asynchronous outcome repeats its originating correlation.
const missingOutcomeCorrelation: EffectOutcomeCommand = {
  observedAt: '2026-03-21T00:00:00.000Z',
  observedAtMs: 1_000,
  type: 'provider.prompt.accepted',
};
void missingOutcomeCorrelation;

type PromptEffect = Extract<SessionEffect, { readonly type: 'provider.prompt' }>;

const missingTurnCorrelation: PromptEffect = {
  // @ts-expect-error A turn-scoped provider effect requires turnId in its correlation.
  correlation: { effectId: 'effect_01', epoch: 1, sessionId: 'session_01' },
  input: { prompt: 'continue', turnId: 'turn_01' },
  providerResourceId: 'provider_01',
  timeoutMs: 1_000,
  type: 'provider.prompt',
};
void missingTurnCorrelation;
