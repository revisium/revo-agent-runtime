import type {
  SessionProtocolCancellationOutcome,
  SessionProtocolCheckpointOutcome,
  SessionProtocolCloseOutcome,
  SessionProtocolInteractionOutcome,
  SessionProtocolPromptOutcome,
} from '../model/outcome.js';
import type {
  SessionProtocolInteractionResponseRequest,
  SessionProtocolPromptRequest,
} from '../model/request.js';
import type { SessionProtocolUpdate } from '../model/update.js';

export interface SessionProtocolObserver {
  update(value: SessionProtocolUpdate): Promise<void>;
}

export type ObservedSessionProtocolPromptRequest = SessionProtocolPromptRequest & {
  readonly observer: SessionProtocolObserver;
};

export interface SessionProtocolPrompt {
  readonly completion: Promise<SessionProtocolPromptOutcome>;
  cancel(reason?: string): Promise<SessionProtocolCancellationOutcome>;
}

export interface SessionProtocolSession {
  prompt(request: ObservedSessionProtocolPromptRequest): SessionProtocolPrompt;
  respond(
    request: SessionProtocolInteractionResponseRequest,
  ): Promise<SessionProtocolInteractionOutcome>;
  checkpoint(): Promise<SessionProtocolCheckpointOutcome>;
  close(reason?: string): Promise<SessionProtocolCloseOutcome>;
}
