import type { AgentRef, JsonObject } from '../../agent-definition.js';
import type { AgentFault, AgentExecutionPin } from '../../manager.js';
import type { AgentSessionCapabilities } from '../capabilities/negotiated.js';
import type { AgentSessionEventCursor } from '../events/event.js';
import type {
  AgentSessionInteractionScope,
  AgentSessionInteractiveRequest,
} from '../interaction/request.js';
import type { AgentSessionResumeToken } from './checkpoint.js';
import type { AgentSessionOutputPublication } from './result.js';

export type AgentSessionStatus =
  | 'opening'
  | 'idle'
  | 'running'
  | 'cancelling'
  | 'checkpointing'
  | 'hibernating'
  | 'closing'
  | 'cleanup_uncertain';

export interface AgentSessionPendingInteraction {
  readonly scope: AgentSessionInteractionScope;
  readonly request: AgentSessionInteractiveRequest;
  readonly state: 'publishing' | 'ready' | 'responding';
}

export interface AgentSessionSnapshot {
  readonly sessionId: string;
  readonly pin: AgentExecutionPin;
  readonly capabilities?: AgentSessionCapabilities;
  readonly status: AgentSessionStatus;
  readonly activeTurnId?: string;
  readonly pendingInteractions: readonly AgentSessionPendingInteraction[];
  readonly metadata?: Readonly<JsonObject>;
  readonly acceptedAt: string;
  readonly openedAt?: string;
  readonly cursor?: AgentSessionEventCursor;
  readonly outputDirectory: string;
}

export interface AgentSessionFilter {
  readonly sessionId?: string;
  readonly agent?: AgentRef;
  readonly statuses?: readonly AgentSessionStatus[];
}

interface AgentSessionTerminalRecordBase {
  readonly sessionId: string;
  readonly pin: AgentExecutionPin;
  readonly acceptedAt: string;
  readonly openedAt?: string;
  readonly finishedAt: string;
  readonly cursor?: AgentSessionEventCursor;
  readonly output?: AgentSessionOutputPublication;
  readonly cleanup: 'confirmed';
}

export type AgentSessionTerminalRecord = AgentSessionTerminalRecordBase &
  (
    | { readonly status: 'closed' | 'cancelled' }
    | { readonly status: 'hibernated'; readonly resumeToken: AgentSessionResumeToken }
    | { readonly status: 'timed_out' | 'failed'; readonly error: AgentFault }
  );

export interface AgentSessionTerminalFilter {
  readonly sessionId?: string;
  readonly agent?: AgentRef;
  readonly statuses?: readonly AgentSessionTerminalRecord['status'][];
}
