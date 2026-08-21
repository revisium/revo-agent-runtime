import type { AgentExecutionPin } from '../agent-definition/index.js';
import type { JsonObject } from '../json/index.js';
import type { AgentLaunchEvidence } from './agent-launch-evidence.js';
import type { AgentOutputFiles } from './agent-output-files.js';
import type { AgentProcessExit } from './agent-process-exit.js';
import type { AgentUsage } from './agent-usage.js';

export interface AgentInvocationResultBase {
  readonly schemaVersion: 'agent-invocation-result/v1';
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly launch: AgentLaunchEvidence;
  readonly metadata?: JsonObject;
  readonly acceptedAt: string;
  readonly startedAt?: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exit: AgentProcessExit;
  readonly usage?: AgentUsage;
  readonly files: AgentOutputFiles;
}
