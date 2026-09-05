import type {
  SessionProtocolCloseOutcome,
  SessionProtocolInteractionOutcome,
  SessionProtocolOpeningOutcome,
} from '../model/outcome.js';
import type { SessionProtocolInteractionResponseRequest } from '../model/request.js';
import type { SessionProtocolObserver, SessionProtocolSession } from './session.js';

interface SessionProtocolTransport {
  readonly input: WritableStream<Uint8Array>;
  readonly output: ReadableStream<Uint8Array>;
}

export interface SessionProtocolOpeningContext {
  readonly transport: SessionProtocolTransport;
  readonly observer: SessionProtocolObserver;
}

type OpenedSessionProtocolResult = Extract<SessionProtocolOpeningOutcome, { status: 'opened' }> & {
  readonly session: SessionProtocolSession;
};

export type SessionProtocolOpeningResult =
  | OpenedSessionProtocolResult
  | Exclude<SessionProtocolOpeningOutcome, { status: 'opened' }>;

export interface SessionProtocolOpening {
  readonly completion: Promise<SessionProtocolOpeningResult>;
  respond(
    request: SessionProtocolInteractionResponseRequest,
  ): Promise<SessionProtocolInteractionOutcome>;
  close(reason?: string): Promise<SessionProtocolCloseOutcome>;
}
