import type { AgentFault } from '../../../../contracts/manager.js';
import type {
  AgentSessionSnapshot,
  AgentSessionTerminalRecord,
} from '../../../../contracts/session.js';
import type { PublicSessionCommand } from '../../kernel/command/public.js';
import type { PublicCallResolution } from '../../kernel/effect/public-call.js';

export type { PublicCallResolution } from '../../kernel/effect/public-call.js';

type SessionCommandAdmission = 'accepted' | 'coalesced' | 'rejected';
export type SessionOpeningCommand = Extract<
  PublicSessionCommand,
  { readonly type: 'session.open' | 'session.resume' }
>;

export interface SessionCommandDispatch {
  dispatch(command: PublicSessionCommand): { readonly state: SessionCommandAdmission };
}

interface SessionRuntimeProjection extends SessionCommandDispatch {
  inspect(): AgentSessionSnapshot | undefined;
  terminal(): AgentSessionTerminalRecord | undefined;
}

export type PublicCallSettlement =
  | { readonly state: 'resolved'; readonly resolution: PublicCallResolution }
  | { readonly state: 'rejected'; readonly fault: AgentFault };

export interface SessionCommandRuntime extends SessionRuntimeProjection {
  registerCall(callId: string): Promise<PublicCallSettlement>;
  whenQuiescent(): Promise<void>;
}

export interface SessionRuntimeFactory {
  createOpening(command: SessionOpeningCommand): SessionCommandRuntime;
}
