import type { AgentRef } from '../agent-definition.js';
import type { AgentConfigurationSelection } from '../configuration.js';
import type { AgentLaunchEvidence } from '../launch.js';
import type { AgentFault, AgentExecutionPin } from './core.js';

export interface StartAgentInvocation {
  readonly invocationId: string;
  readonly agent: { readonly id: string; readonly version: string };
  readonly prompt: string;
  readonly configuration?: AgentConfigurationSelection;
  readonly workspace: { readonly directory: string };
  readonly parameters: Record<string, unknown>;
  readonly permissions: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly result: { readonly schema: Record<string, unknown> };
  readonly output: { readonly directory: string };
  readonly limits?: {
    readonly wallClockTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
    readonly maxEventBytes?: number;
    readonly maxEventsFileBytes?: number;
    readonly maxStdoutBytes?: number;
    readonly maxStderrBytes?: number;
    readonly maxRawResponseBytes?: number;
  };
}

export interface AgentStartContext {
  readonly signal?: AbortSignal;
  readonly environment?: {
    readonly inherit: readonly string[];
    readonly variables: Readonly<Record<string, string>>;
    readonly secrets: Readonly<Record<string, string>>;
  };
}

export interface AgentOutputFiles {
  readonly directory: string;
  readonly events: 'events.ndjson';
  readonly stdout: 'stdout.log';
  readonly stderr: 'stderr.log';
  readonly result?: 'result.json';
  readonly rawFinalResponse?: 'raw-final-response.txt';
}

export interface AgentCommittedOutputFiles extends AgentOutputFiles {
  readonly result: 'result.json';
}

export interface AgentRawResponseDiagnostic {
  readonly byteLength: number;
  readonly retainedByteLength: number;
  readonly preview: string;
  readonly truncated: boolean;
  readonly file?: 'raw-final-response.txt';
}

export interface AgentProcessExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface AgentUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

interface AgentInvocationResultBase {
  readonly schemaVersion: 'agent-invocation-result/v1';
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly launch: AgentLaunchEvidence;
  readonly metadata?: Record<string, unknown>;
  readonly acceptedAt: string;
  readonly startedAt?: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exit: AgentProcessExit;
  readonly usage?: AgentUsage;
  readonly files: AgentOutputFiles;
}

export interface AgentInvocationSucceeded extends AgentInvocationResultBase {
  readonly status: 'succeeded';
  readonly files: AgentCommittedOutputFiles;
  readonly value: Record<string, unknown>;
}

export interface AgentInvocationFailed extends AgentInvocationResultBase {
  readonly status: 'failed';
  readonly error: AgentFault;
  readonly rawResponse?: AgentRawResponseDiagnostic;
}

export interface AgentInvocationCancelled extends AgentInvocationResultBase {
  readonly status: 'cancelled';
  readonly files: AgentCommittedOutputFiles;
  readonly error: AgentFault;
}

export interface AgentInvocationTimedOut extends AgentInvocationResultBase {
  readonly status: 'timed_out';
  readonly files: AgentCommittedOutputFiles;
  readonly error: AgentFault;
}

export type AgentInvocationResult =
  | AgentInvocationSucceeded
  | AgentInvocationFailed
  | AgentInvocationCancelled
  | AgentInvocationTimedOut;

export type AgentInvocationStatus =
  | 'accepted'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface AgentInvocationFilter {
  readonly invocationId?: string;
  readonly agent?: AgentRef;
  readonly statuses?: readonly AgentInvocationStatus[];
}

export interface AgentInvocationSnapshot {
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly status: AgentInvocationStatus;
  readonly metadata?: Record<string, unknown>;
  readonly acceptedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly outputDirectory: string;
}

export type AgentResultLookup =
  | { readonly state: 'running'; readonly invocation: AgentInvocationSnapshot }
  | { readonly state: 'completed'; readonly result: AgentInvocationResult }
  | { readonly state: 'unknown' };

export interface AgentProbeAvailable {
  readonly status: 'available';
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly executable: string;
  readonly reportedVersion?: string;
}

export interface AgentProbeUnavailable {
  readonly status: 'unavailable';
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly error: AgentFault;
}

export type AgentProbeResult = AgentProbeAvailable | AgentProbeUnavailable;

export type CancelInvocationResult =
  | { readonly state: 'requested' }
  | { readonly state: 'already_completed'; readonly result: AgentInvocationResult }
  | { readonly state: 'unknown' };

export interface AgentInvocationHandle {
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  result(): Promise<AgentInvocationResult>;
  cancel(reason?: string): Promise<CancelInvocationResult>;
}
