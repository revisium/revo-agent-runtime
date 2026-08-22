import type { AgentFaultCode, AgentValidationDetails } from '../spec/index.js';
import type { InterimDuplexPrimaryFailure } from './interim-duplex-primary-failure.js';
import type { ParserFailureReason } from './result-parser/index.js';

export type NormalizedInvocationFailure =
  | Readonly<{ kind: 'parser'; reason: ParserFailureReason; code: AgentFaultCode }>
  | Readonly<{ kind: 'duplex'; primary: InterimDuplexPrimaryFailure; code: AgentFaultCode }>
  | Readonly<{
      kind: 'result_schema';
      code: 'revo.agent.result_schema_mismatch';
      diagnostics?: AgentValidationDetails;
    }>
  | Readonly<{
      kind: 'finalization';
      code: 'revo.agent.scratch_cleanup_failed' | 'revo.agent.output_write_failed';
    }>;
