import type { AgentExecutionPin, AgentRef } from '../agent-definition/index.js';
import type { AgentInvocationResult } from '../agent-invocation-result/index.js';
import type { JsonObject, JsonSchema202012 } from '../json/index.js';
import type { CancelInvocationResult } from './agent-result-lookup.js';

export interface StartAgentInvocation {
  readonly invocationId: string;
  readonly agent: AgentRef;
  readonly prompt: string;
  readonly workspace: {
    readonly directory: string;
  };
  readonly parameters: JsonObject;
  readonly permissions: JsonObject;
  readonly metadata?: JsonObject;
  readonly result: {
    readonly schema: JsonSchema202012;
  };
  readonly limits?: {
    readonly wallClockTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
    readonly maxEventBytes?: number;
    readonly maxEventsFileBytes?: number;
    readonly maxStdoutBytes?: number;
    readonly maxStderrBytes?: number;
    readonly maxRawResponseBytes?: number;
  };
  readonly output: {
    readonly directory: string;
  };
}

export interface AgentStartContext {
  readonly signal?: AbortSignal;
  readonly environment?: {
    readonly inherit?: readonly string[];
    readonly variables?: Readonly<Record<string, string>>;
    readonly secrets?: Readonly<Record<string, string>>;
  };
}

export interface AgentInvocationHandle {
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  result(): Promise<AgentInvocationResult>;
  cancel(reason?: string): Promise<CancelInvocationResult>;
}
