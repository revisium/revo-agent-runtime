import type { EffectCorrelation } from '../model/identity.js';
import type { SessionTimerState } from '../model/session-state.js';

interface TimerFiredCommand {
  readonly type: 'timer.fired';
  readonly correlation: EffectCorrelation;
  readonly timerId: string;
  readonly kind: SessionTimerState['kind'];
  readonly generation: number;
  readonly firedAt: string;
}

export type TimerCommand = TimerFiredCommand;
