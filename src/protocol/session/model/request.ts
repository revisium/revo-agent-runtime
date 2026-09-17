import type { AgentDefinition, JsonObject } from '../../../contracts/agent-definition.js';
import type { AgentConfigurationSelection } from '../../../contracts/configuration.js';
import type { AgentInstructionsDelivery, AgentMcpServer } from '../../../contracts/context.js';

/** Instructions with their pre-decided channel and checkpoint identity for this incarnation. */
export interface SessionProtocolInstructions {
  readonly text: string;
  readonly digest: string;
  readonly delivery: AgentInstructionsDelivery;
  readonly sessionMeta?: Readonly<JsonObject>;
  /** True when a checkpointed prefix already reached the provider transcript. */
  readonly dispatched: boolean;
}

interface SessionProtocolOpeningRequestBase {
  readonly definition: AgentDefinition;
  readonly workspace: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly permissions: Readonly<Record<string, unknown>>;
  readonly configuration?: AgentConfigurationSelection;
  readonly instructions?: SessionProtocolInstructions;
  readonly mcpServers?: readonly AgentMcpServer[];
}

export interface FreshSessionProtocolRequest extends SessionProtocolOpeningRequestBase {
  readonly kind: 'fresh';
}

export interface ResumeSessionProtocolRequest extends SessionProtocolOpeningRequestBase {
  readonly kind: 'resume';
  readonly continuation: SessionProtocolContinuation;
}

export interface SessionProtocolContinuation {
  readonly format: string;
  readonly data: Readonly<JsonObject>;
}

export interface SessionProtocolPromptRequest {
  readonly prompt: string;
  readonly metadata?: Readonly<JsonObject>;
}

type SessionProtocolInputValue = string | number | boolean | readonly string[];

type SessionProtocolInteractionResponse =
  | { readonly kind: 'permission'; readonly outcome: 'selected'; readonly optionId: string }
  | { readonly kind: 'permission'; readonly outcome: 'denied' }
  | {
      readonly kind: 'input';
      readonly outcome: 'submitted';
      readonly values: Readonly<Record<string, SessionProtocolInputValue>>;
    }
  | { readonly kind: 'input'; readonly outcome: 'declined' | 'cancelled' };

export interface SessionProtocolInteractionResponseRequest {
  readonly requestId: string;
  readonly response: SessionProtocolInteractionResponse;
}
