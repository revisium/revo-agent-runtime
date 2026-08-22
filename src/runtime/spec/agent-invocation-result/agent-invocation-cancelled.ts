import type { AgentFault } from '../agent-fault/index.js';
import type { AgentInvocationResultBase } from './agent-invocation-result-base.js';
import type { AgentCommittedOutputFiles } from './agent-output-files.js';

export interface AgentInvocationCancelled extends AgentInvocationResultBase {
  readonly status: 'cancelled';
  readonly files: AgentCommittedOutputFiles;
  readonly error: AgentFault;
}
