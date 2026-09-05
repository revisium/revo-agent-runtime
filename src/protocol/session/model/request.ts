import type { AgentDefinition, JsonObject } from '../../../contracts/agent-definition.js';
import type { AgentConfigurationSelection } from '../../../contracts/configuration.js';

interface SessionProtocolOpeningRequestBase {
  readonly definition: AgentDefinition;
  readonly workspace: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly permissions: Readonly<Record<string, unknown>>;
  readonly configuration?: AgentConfigurationSelection;
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
