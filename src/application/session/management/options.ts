import type { AgentDescriptor } from '../../../contracts/manager/core.js';
import type { AgentSessionManagerLimits } from '../../../contracts/session.js';
import type { ActiveAgentSessionStateSink } from '../../../contracts/session/persistence/active-state.js';
import type { RecoveredProcessInspector } from '../../../execution/process/port.js';
import type { SessionRuntimeFactory } from '../../../execution/session/runtime/actor/port.js';

type ManagedSessionIdentityKind = 'call' | 'checkpoint' | 'resume_token' | 'incarnation' | 'stream';

export interface ManagedAgentSessionsOptions {
  readonly redactionSecrets?: readonly string[];
  readonly hostEnvironment?: () => Readonly<Record<string, string | undefined>>;
  readonly agents: readonly AgentDescriptor[];
  readonly clock: { now(): { readonly iso: string; readonly milliseconds: number } };
  readonly digest: { digest(bytes: Uint8Array): string };
  readonly limits?: AgentSessionManagerLimits;
  readonly nextIdentity: (kind: ManagedSessionIdentityKind) => string;
  readonly activeStateSink?: ActiveAgentSessionStateSink;
  readonly recoveryInspector?: RecoveredProcessInspector;
  readonly runtimeFactory: SessionRuntimeFactory;
}
