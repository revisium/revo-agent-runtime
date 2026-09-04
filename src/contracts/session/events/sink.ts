import type { AgentSessionEvent, AgentSessionEventCursor } from './event.js';

export type AgentSessionEventAppendResult =
  | { readonly state: 'appended' }
  | { readonly state: 'conflict'; readonly actual?: AgentSessionEventCursor };

export type AgentSessionEventAppendPrecondition =
  | { readonly kind: 'empty' }
  | { readonly kind: 'cursor'; readonly cursor: AgentSessionEventCursor }
  | {
      readonly kind: 'hibernation_token';
      readonly cursor: AgentSessionEventCursor;
      readonly resumeTokenId: string;
      readonly resumeTokenSha256: string;
    };

export interface AgentSessionEventSink {
  append(
    event: AgentSessionEvent,
    context: {
      readonly expected: AgentSessionEventAppendPrecondition;
      readonly signal: AbortSignal;
    },
  ): Promise<AgentSessionEventAppendResult>;
}
