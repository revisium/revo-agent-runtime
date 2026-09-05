import type { JsonObject } from '../../../contracts/agent-definition.js';
import type { AgentExecutionPin } from '../../../contracts/manager.js';
import type {
  AgentSessionCapabilities,
  RespondAgentSessionRequest,
} from '../../../contracts/session.js';
import type { SessionCommandRuntime } from '../../../execution/session/runtime/actor/port.js';

interface DecodedSendAgentSessionInput {
  readonly turnId: string;
  readonly prompt: string;
  readonly metadata?: Readonly<JsonObject>;
}

interface SessionHandleClock {
  now(): { readonly iso: string; readonly milliseconds: number };
}

type SessionHandleIdentityKind = 'call' | 'checkpoint' | 'resume_token';

export interface AgentSessionHandleOptions {
  readonly capabilities: AgentSessionCapabilities;
  readonly clock: SessionHandleClock;
  readonly decodeResponse: (value: unknown) => RespondAgentSessionRequest;
  readonly decodeSend: (value: unknown) => DecodedSendAgentSessionInput;
  readonly epoch: number;
  readonly nextIdentity: (kind: SessionHandleIdentityKind) => string;
  readonly onSettled: () => void;
  readonly pin: AgentExecutionPin;
  readonly runtime: SessionCommandRuntime;
  readonly sessionId: string;
}
