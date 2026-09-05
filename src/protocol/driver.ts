import type { AgentDefinition } from '../contracts/agent-definition.js';
import type { AgentConfigurationSelection } from '../contracts/configuration.js';
import type { AgentUsage } from '../contracts/manager/invocation.js';

interface ProtocolTransport {
  readonly input: WritableStream<Uint8Array>;
  readonly output: ReadableStream<Uint8Array>;
}

export interface ProtocolObserver {
  activity(): void;
  resultChunk(bytes: Uint8Array): void;
  usage(value: AgentUsage): void;
  permission(request: ProtocolPermissionRequest): Promise<ProtocolPermissionDecision>;
}

interface ProtocolPermissionRequest {
  readonly options: readonly {
    readonly id: string;
    readonly kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  }[];
}

export type ProtocolPermissionDecision =
  | { readonly outcome: 'selected'; readonly optionId: string }
  | { readonly outcome: 'denied' };

export interface ProtocolSessionRequest {
  readonly transport: ProtocolTransport;
  readonly definition: AgentDefinition;
  readonly configuration?: AgentConfigurationSelection;
  readonly workspace: string;
  readonly prompt: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly permissions: Readonly<Record<string, unknown>>;
  readonly resultSchema: Readonly<Record<string, unknown>>;
  readonly observer: ProtocolObserver;
}

export type ProtocolOutcome =
  | { readonly status: 'completed' }
  | {
      readonly status: 'failed';
      readonly code?:
        | 'revo.agent.configuration_stale'
        | 'revo.agent.configuration_value_unsupported';
    };

export interface ProtocolSession {
  readonly completion: Promise<ProtocolOutcome>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export interface ProtocolDriver {
  open(request: ProtocolSessionRequest): Promise<ProtocolSession>;
}
