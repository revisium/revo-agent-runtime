import type {
  ActiveProcessIdentity,
  AgentExecutionPin,
} from '../../../../contracts/manager/core.js';
import type { AgentSessionEventCursor } from '../../../../contracts/session/events/event.js';
import type { AgentSessionUsage } from '../../../../contracts/session/lifecycle/result.js';
import type { EffectCorrelation } from '../model/identity.js';
import type { SessionOpeningDescriptor } from '../model/opening-state.js';
import type { SessionTimerState } from '../model/session-state.js';

interface PrepareSessionOpeningEffect {
  readonly type: 'opening.prepare';
  readonly correlation: EffectCorrelation;
  readonly opening: SessionOpeningDescriptor;
  readonly timeoutMs: number;
}

type CaptureCheckpointEffect = {
  readonly acceptedTurnIds?: readonly string[];
  readonly type: 'checkpoint.capture';
  readonly correlation: EffectCorrelation;
  readonly providerResourceId: string;
  readonly pin: AgentExecutionPin;
  readonly cursor: AgentSessionEventCursor;
  readonly usageBaseline: AgentSessionUsage;
  readonly maxBytes: number;
  readonly timeoutMs: number;
} & (
  | { readonly kind: 'checkpoint'; readonly checkpointId: string }
  | { readonly kind: 'hibernate'; readonly resumeTokenId: string }
);

interface ScheduleSessionTimerEffect {
  readonly type: 'timer.schedule';
  readonly correlation: EffectCorrelation;
  readonly timer: SessionTimerState;
}

interface CancelSessionTimerEffect {
  readonly type: 'timer.cancel';
  readonly correlation: EffectCorrelation;
  readonly timerId: string;
  readonly generation: number;
}

interface PublishSessionOutputEffect {
  readonly type: 'output.publish';
  readonly correlation: EffectCorrelation;
  readonly publication: {
    readonly sessionId: string;
    readonly pin: AgentExecutionPin;
    readonly status: 'hibernated' | 'closed' | 'cancelled' | 'timed_out' | 'failed';
    readonly acceptedAt: string;
    readonly openedAt?: string;
    readonly finishedAt: string;
    readonly cursor?: AgentSessionEventCursor;
  };
  readonly outputDirectory: string;
  readonly maxBytes: number;
}

interface CleanupSessionProcessEffect {
  readonly type: 'process.cleanup';
  readonly correlation: EffectCorrelation;
  readonly processResourceId: string;
  readonly process: ActiveProcessIdentity;
  readonly reason?: string;
  readonly timeoutMs: number;
}

export type SessionLifecycleEffect =
  | PrepareSessionOpeningEffect
  | CaptureCheckpointEffect
  | ScheduleSessionTimerEffect
  | CancelSessionTimerEffect
  | PublishSessionOutputEffect
  | CleanupSessionProcessEffect;
