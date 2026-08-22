import type { AgentFault } from '../agent-fault/index.js';
import type { AgentInvocationResultBase } from './agent-invocation-result-base.js';
import type { AgentOutputFiles } from './agent-output-files.js';
import type { AgentRawResponseDiagnostic } from './agent-raw-response-diagnostic.js';

export interface AgentInvocationFailed extends AgentInvocationResultBase {
  readonly status: 'failed';
  readonly files: AgentOutputFiles;
  readonly error: AgentFault;
  readonly rawResponse?: AgentRawResponseDiagnostic;
}
