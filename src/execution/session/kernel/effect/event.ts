import type { AgentSessionEvent } from '../../../../contracts/session/events/event.js';
import type { AgentSessionEventAppendPrecondition } from '../../../../contracts/session/events/sink.js';
import type { EffectCorrelation } from '../model/identity.js';

interface AppendSessionEventEffect {
  readonly type: 'event.append';
  readonly correlation: EffectCorrelation;
  readonly event: AgentSessionEvent;
  readonly expected: AgentSessionEventAppendPrecondition;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

export type SessionEventEffect = AppendSessionEventEffect;
