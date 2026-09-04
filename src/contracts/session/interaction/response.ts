export type AgentSessionInputValue = string | number | boolean | readonly string[];

export type AgentSessionInteractiveResponse =
  | { readonly kind: 'permission'; readonly outcome: 'selected'; readonly optionId: string }
  | { readonly kind: 'permission'; readonly outcome: 'denied' }
  | {
      readonly kind: 'input';
      readonly outcome: 'submitted';
      readonly values: Readonly<Record<string, AgentSessionInputValue>>;
    }
  | { readonly kind: 'input'; readonly outcome: 'declined' | 'cancelled' };

export interface RespondAgentSessionRequest {
  readonly requestId: string;
  readonly response: AgentSessionInteractiveResponse;
}

export type RespondAgentSessionResult =
  | { readonly state: 'accepted' }
  | { readonly state: 'already_resolved' };
