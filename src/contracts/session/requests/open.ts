import type { AgentRef } from '../../agent-definition.js';
import type { AgentConfigurationSelection } from '../../configuration.js';
import type { AgentStartContext } from '../../manager.js';

export type AgentSessionLaunchContext = AgentStartContext;

export interface AgentSessionLimits {
  readonly openingTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly wallClockTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
  readonly eventSinkTimeoutMs?: number;
  readonly maxEventBytes?: number;
  readonly maxMessageBytes?: number;
  readonly maxPromptBytes?: number;
  readonly maxMetadataBytes?: number;
  readonly maxInteractionBytes?: number;
  readonly maxCheckpointBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxPendingInteractions?: number;
}

export interface AgentSessionLaunchInput {
  readonly workspace: { readonly directory: string };
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly permissions: Readonly<Record<string, unknown>>;
  readonly configuration?: AgentConfigurationSelection;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly output: { readonly directory: string };
  readonly limits?: AgentSessionLimits;
}

export interface OpenAgentSession extends AgentSessionLaunchInput {
  readonly sessionId: string;
  readonly agent: AgentRef;
}
