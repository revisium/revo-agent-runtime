import type { AgentUsage } from '../../../contracts/manager/invocation.js';
import type { SessionProtocolFailure } from '../errors/protocol-error.js';
import type { SessionProtocolContinuation } from './request.js';

export interface SessionProtocolCapabilities {
  readonly multiTurn: true;
  readonly resume: 'none' | 'native';
  readonly cancellation: { readonly prompt: boolean; readonly session: true };
  readonly interactions: { readonly permission: boolean; readonly input: boolean };
  readonly updates: {
    readonly message: true;
    readonly progress: boolean;
    readonly tool: boolean;
    readonly plan: boolean;
    readonly usage: boolean;
  };
}

export type SessionProtocolOpeningOutcome =
  | { readonly status: 'opened'; readonly capabilities: SessionProtocolCapabilities }
  | {
      readonly status: 'unsupported' | 'rejected' | 'failed';
      readonly failure: SessionProtocolFailure;
    };

export type SessionProtocolPromptOutcome =
  | { readonly status: 'completed'; readonly usage?: AgentUsage }
  | { readonly status: 'cancelled' | 'interrupted' }
  | { readonly status: 'failed'; readonly failure: SessionProtocolFailure };

export type SessionProtocolInteractionOutcome =
  | { readonly status: 'accepted' }
  | { readonly status: 'rejected' | 'failed'; readonly failure: SessionProtocolFailure };

export type SessionProtocolCheckpointOutcome =
  | { readonly status: 'captured'; readonly continuation: SessionProtocolContinuation }
  | { readonly status: 'unsupported' | 'failed'; readonly failure: SessionProtocolFailure };

export type SessionProtocolCancellationOutcome =
  | { readonly status: 'requested' | 'unsupported' }
  | { readonly status: 'failed'; readonly failure: SessionProtocolFailure };

export type SessionProtocolCloseOutcome =
  | { readonly status: 'closed' }
  | { readonly status: 'failed'; readonly failure: SessionProtocolFailure };
