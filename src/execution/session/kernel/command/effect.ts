import type { ActiveProcessIdentity, AgentFault } from '../../../../contracts/manager/core.js';
import type { AgentSessionCapabilities } from '../../../../contracts/session/capabilities/negotiated.js';
import type { AgentSessionEventAppendResult } from '../../../../contracts/session/events/sink.js';
import type {
  AgentSessionCheckpoint,
  AgentSessionResumeToken,
} from '../../../../contracts/session/lifecycle/checkpoint.js';
import type {
  AgentSessionOutputPublication,
  AgentSessionTurnOutcome,
} from '../../../../contracts/session/lifecycle/result.js';
import type { ActiveAgentSessionStateMutationResult } from '../../../../contracts/session/persistence/active-state.js';
import type { EffectCorrelation, TurnEffectCorrelation } from '../model/identity.js';

type Outcome<
  Type extends string,
  Payload extends object = object,
  Correlation extends EffectCorrelation = EffectCorrelation,
> = Readonly<
  {
    type: Type;
    correlation: Correlation;
    observedAt: string;
    observedAtMs: number;
  } & Payload
>;

type FaultOutcome<
  Type extends string,
  Correlation extends EffectCorrelation = EffectCorrelation,
> = Outcome<Type, { readonly fault: AgentFault }, Correlation>;

type OpeningPreparationOutcome =
  | Outcome<'opening.preparation.succeeded', { readonly preparationId: string }>
  | FaultOutcome<'opening.preparation.rejected'>
  | FaultOutcome<'opening.preparation.failed'>
  | FaultOutcome<'opening.preparation.timed_out'>;

type ProcessStartedPayload = {
  readonly processResourceId: string;
  readonly process: ActiveProcessIdentity;
};

type ProcessStartOutcome =
  | Outcome<'process.exited', { readonly processResourceId: string; readonly fault: AgentFault }>
  | Outcome<'process.started', ProcessStartedPayload>
  | FaultOutcome<'process.failed'>
  | FaultOutcome<'process.timed_out'>
  | Outcome<'process.late_started', ProcessStartedPayload>;

type ProviderOpenOutcome =
  | Outcome<
      'provider.opened',
      { readonly providerResourceId: string; readonly capabilities: AgentSessionCapabilities }
    >
  | FaultOutcome<'provider.open_failed'>
  | FaultOutcome<'provider.open_timed_out'>;

type EventAppliedPayload = { readonly result: AgentSessionEventAppendResult };

type EventAppendOutcome =
  | Outcome<'event.applied', EventAppliedPayload>
  | FaultOutcome<'event.failed'>
  | Outcome<'event.timed_out_then_applied', EventAppliedPayload>
  | FaultOutcome<'event.timed_out_then_failed'>
  | FaultOutcome<'event.unknown'>;

type PersistenceAppliedPayload = { readonly result: ActiveAgentSessionStateMutationResult };

type PersistenceOutcome =
  | Outcome<'persistence.applied', PersistenceAppliedPayload>
  | FaultOutcome<'persistence.failed'>
  | Outcome<'persistence.late_applied', PersistenceAppliedPayload>
  | FaultOutcome<'persistence.late_failed'>
  | FaultOutcome<'persistence.unknown'>;

type ProviderPromptOutcome =
  | Outcome<'provider.prompt.accepted', object, TurnEffectCorrelation>
  | Outcome<
      'provider.prompt.completed',
      { readonly outcome: AgentSessionTurnOutcome },
      TurnEffectCorrelation
    >
  | FaultOutcome<'provider.prompt.rejected', TurnEffectCorrelation>
  | FaultOutcome<'provider.prompt.failed', TurnEffectCorrelation>
  | FaultOutcome<'provider.prompt.timed_out', TurnEffectCorrelation>;

type ProviderInteractionOutcome =
  | Outcome<'provider.interaction.accepted'>
  | FaultOutcome<'provider.interaction.rejected'>
  | FaultOutcome<'provider.interaction.failed'>
  | FaultOutcome<'provider.interaction.timed_out'>;

type CapturedContinuation =
  | { readonly kind: 'checkpoint'; readonly checkpoint: AgentSessionCheckpoint }
  | { readonly kind: 'hibernate'; readonly resumeToken: AgentSessionResumeToken };

type CheckpointCaptureOutcome =
  | Outcome<'checkpoint.captured', CapturedContinuation>
  | FaultOutcome<'checkpoint.unsupported'>
  | FaultOutcome<'checkpoint.failed'>
  | FaultOutcome<'checkpoint.timed_out'>;

type ProcessCleanupOutcome =
  | Outcome<'process.cleanup.confirmed'>
  | FaultOutcome<'process.cleanup.uncertain'>;

type UnpublishedOutput = Extract<
  AgentSessionOutputPublication,
  { readonly state: 'failed' | 'uncertain' }
>;

type OutputPublicationOutcome =
  | Outcome<
      'output.published',
      { readonly output: Extract<AgentSessionOutputPublication, { readonly state: 'published' }> }
    >
  | Outcome<'output.failed', { readonly output: UnpublishedOutput & { readonly state: 'failed' } }>
  | Outcome<
      'output.uncertain',
      { readonly output: UnpublishedOutput & { readonly state: 'uncertain' } }
    >;

export type EffectOutcomeCommand =
  | OpeningPreparationOutcome
  | ProcessStartOutcome
  | ProviderOpenOutcome
  | EventAppendOutcome
  | PersistenceOutcome
  | ProviderPromptOutcome
  | ProviderInteractionOutcome
  | CheckpointCaptureOutcome
  | ProcessCleanupOutcome
  | OutputPublicationOutcome;
