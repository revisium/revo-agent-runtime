import type { JsonObject } from '../../../../contracts/agent-definition.js';
import type {
  ActiveProcessIdentity,
  AgentExecutionPin,
  AgentFault,
} from '../../../../contracts/manager/core.js';
import type { AgentSessionCapabilities } from '../../../../contracts/session/capabilities/negotiated.js';
import type { AgentSessionUsage } from '../../../../contracts/session/lifecycle/result.js';
import type {
  AgentSessionLimits,
  OpenAgentSession,
} from '../../../../contracts/session/requests/open.js';
import type { ResumeAgentSession } from '../../../../contracts/session/requests/resume.js';
import type { EffectCorrelation } from './identity.js';

type SessionLaunchEnvironment = Readonly<{
  inherit: readonly string[];
  variables: Readonly<Record<string, string>>;
  secrets: Readonly<Record<string, string>>;
}>;
type ProviderContinuation = Readonly<{ format: string; data: Readonly<JsonObject> }>;

export type SessionOpeningRequest =
  | { readonly kind: 'fresh'; readonly request: OpenAgentSession }
  | {
      readonly kind: 'resume';
      readonly request: ResumeAgentSession;
      readonly continuation: ProviderContinuation;
    };

export interface SessionOpeningDescriptor {
  readonly incarnationId: string;
  readonly pin: AgentExecutionPin;
  readonly request: SessionOpeningRequest;
  readonly environment?: SessionLaunchEnvironment;
  readonly limits: Required<AgentSessionLimits>;
  readonly usageBaseline: AgentSessionUsage;
  readonly acceptedAt: string;
  readonly acceptedAtMs: number;
  readonly streamId: string;
  readonly metadata?: Readonly<JsonObject>;
}

type PreparedOpening = { readonly preparationId: string; readonly resumed: boolean };
type OwnedOpeningProcess = PreparedOpening & {
  readonly processResourceId: string;
  readonly process: ActiveProcessIdentity;
};

export type OpeningProgress =
  | { readonly stage: 'publishing_accepted'; readonly opening: SessionOpeningDescriptor }
  | {
      readonly stage: 'preparing';
      readonly opening: SessionOpeningDescriptor;
      readonly correlation: EffectCorrelation;
    }
  | (PreparedOpening & {
      readonly stage: 'starting_process';
      readonly correlation: EffectCorrelation;
    })
  | (OwnedOpeningProcess & {
      readonly stage: 'saving_process' | 'opening_provider';
      readonly correlation: EffectCorrelation;
    })
  | {
      readonly stage: 'cleaning_process';
      readonly processResourceId: string;
      readonly process: ActiveProcessIdentity;
      readonly fault: AgentFault;
      readonly afterCleanup: 'fail' | 'remove_state' | 'uncertain';
      readonly correlation: EffectCorrelation;
    }
  | {
      readonly stage: 'removing_state';
      readonly fault: AgentFault;
      readonly correlation: EffectCorrelation;
    }
  | {
      readonly stage: 'publishing_opened';
      readonly processResourceId: string;
      readonly process: ActiveProcessIdentity;
      readonly providerResourceId: string;
      readonly capabilities: AgentSessionCapabilities;
      readonly openedAtMs: number;
      readonly resumed: boolean;
    };
