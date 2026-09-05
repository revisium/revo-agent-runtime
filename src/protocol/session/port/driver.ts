import type {
  FreshSessionProtocolRequest,
  ResumeSessionProtocolRequest,
} from '../model/request.js';
import type { SessionProtocolOpening, SessionProtocolOpeningContext } from './opening.js';

export type FreshSessionProtocolOpeningRequest = FreshSessionProtocolRequest &
  SessionProtocolOpeningContext;

export type ResumeSessionProtocolOpeningRequest = ResumeSessionProtocolRequest &
  SessionProtocolOpeningContext;

export interface SessionProtocolDriver {
  openFresh(request: FreshSessionProtocolOpeningRequest): SessionProtocolOpening;
  resume(request: ResumeSessionProtocolOpeningRequest): SessionProtocolOpening;
}
