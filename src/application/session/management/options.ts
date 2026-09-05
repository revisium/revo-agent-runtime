import type { AgentDescriptor } from '../../../contracts/manager.js';
import type { AgentSessionManagerLimits } from '../../../contracts/session.js';
import type { SessionRuntimeFactory } from '../../../execution/session/runtime/actor/port.js';

type ManagedSessionIdentityKind = 'call' | 'checkpoint' | 'resume_token' | 'incarnation' | 'stream';

export interface ManagedAgentSessionsOptions {
  readonly agents: readonly AgentDescriptor[];
  readonly clock: { now(): { readonly iso: string; readonly milliseconds: number } };
  readonly digest: { digest(bytes: Uint8Array): string };
  readonly limits?: AgentSessionManagerLimits;
  readonly nextIdentity: (kind: ManagedSessionIdentityKind) => string;
  readonly runtimeFactory: SessionRuntimeFactory;
}
