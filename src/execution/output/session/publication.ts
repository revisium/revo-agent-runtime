import type { AgentExecutionPin } from '../../../contracts/manager/core.js';
import type { AgentSessionEventCursor } from '../../../contracts/session/events/event.js';
import type { AgentSessionOutputPublication } from '../../../contracts/session/lifecycle/result.js';

interface SessionOutputPublicationInput {
  readonly sessionId: string;
  readonly pin: AgentExecutionPin;
  readonly status: 'hibernated' | 'closed' | 'cancelled' | 'timed_out' | 'failed';
  readonly acceptedAt: string;
  readonly openedAt?: string;
  readonly finishedAt: string;
  readonly cursor?: AgentSessionEventCursor;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly truncated: { readonly stdout: boolean; readonly stderr: boolean };
}

/** A single-use capability for one output directory already claimed during opening. */
export interface SessionOutputPublicationTarget {
  publish(input: SessionOutputPublicationInput): Promise<AgentSessionOutputPublication>;
}
