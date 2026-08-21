import type { JsonObject } from '../json/index.js';
import type { AgentInvocationResultBase } from './agent-invocation-result-base.js';
import type { AgentCommittedOutputFiles } from './agent-output-files.js';

export interface AgentInvocationSucceeded extends AgentInvocationResultBase {
  readonly status: 'succeeded';
  readonly files: AgentCommittedOutputFiles;
  readonly value: JsonObject;
}
