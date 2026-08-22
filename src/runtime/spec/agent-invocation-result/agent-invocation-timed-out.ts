import type { AgentFault } from '../agent-fault/index.js';
import type { AgentInvocationResultBase } from './agent-invocation-result-base.js';
import type { AgentCommittedOutputFiles } from './agent-output-files.js';

export interface AgentInvocationTimedOut extends AgentInvocationResultBase {
  readonly status: 'timed_out';
  readonly files: AgentCommittedOutputFiles;
  readonly error: AgentFault;
}
