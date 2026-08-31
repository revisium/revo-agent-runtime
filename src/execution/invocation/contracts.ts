import type { AgentDefinition } from '../../contracts/agent-definition.js';
import type { AgentConfigurationSelection } from '../../contracts/configuration.js';
import type { AgentLaunchEvidence } from '../../contracts/manager.js';
import type { OwnedProcess, ProcessExit } from '../process/port.js';
import type { ExecutionOutcome } from './terminal.js';

export type ExecutionDrainage =
  | {
      readonly status: 'terminal';
      readonly outcome: ExecutionOutcome;
      readonly evidence?: ExecutionEvidence;
    }
  | { readonly status: 'cleanup_uncertain' };

export interface ExecutionEvidence {
  readonly launch: AgentLaunchEvidence;
  readonly processExit: ProcessExit;
}

export type ExecutionAdmission =
  | {
      readonly status: 'accepted';
      readonly identity: OwnedProcess['identity'];
      readonly launch: AgentLaunchEvidence;
    }
  | {
      readonly status: 'rejected';
      readonly outcome: ExecutionOutcome;
      readonly cleanup: 'confirmed' | 'uncertain';
      readonly evidence?: ExecutionEvidence;
    };

export interface InvocationExecution {
  readonly admission: Promise<ExecutionAdmission>;
  readonly completion: Promise<ExecutionOutcome>;
  readonly drainage: Promise<ExecutionDrainage>;
  activate(): void;
  cancel(): boolean;
  evidence(): ExecutionEvidence | undefined;
  output?(): Readonly<{ stdout: Uint8Array; stderr: Uint8Array }>;
}

export interface InvocationExecutionRequest {
  readonly definition: AgentDefinition;
  readonly configuration?: AgentConfigurationSelection;
  readonly launch: AgentLaunchEvidence;
  readonly workspace: string;
  readonly prompt: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly permissions: Readonly<Record<string, unknown>>;
  readonly resultSchema: Readonly<Record<string, unknown>>;
  readonly wallClockTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly onStarted: () => void;
  readonly onCancelling: () => void;
  readonly environment?: Readonly<Record<string, string>>;
  readonly redactionSecrets?: readonly string[];
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly maxRawResponseBytes?: number;
}

export interface InvocationExecutor {
  start(request: InvocationExecutionRequest): InvocationExecution;
}
