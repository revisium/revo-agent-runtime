import type { AgentFaultCode } from '../spec/index.js';
import type { InterimDuplexPrimaryFailure } from './interim-duplex-primary-failure.js';
import { parserFailureCode } from './parser-failure-code.js';

type MappedInterimDuplexPrimaryFailure = Exclude<
  InterimDuplexPrimaryFailure,
  Readonly<{ kind: 'result_schema_failed' }>
>;

const isOutputOperation = (
  operation: Extract<
    InterimDuplexPrimaryFailure,
    { kind: 'duplex_operation_timeout' }
  >['operation'],
): boolean => {
  switch (operation) {
    case 'stdout_write':
    case 'stdout_end':
    case 'stderr_write':
    case 'stderr_end':
      return true;
    case 'attach':
    case 'stdin_write':
    case 'stdin_end':
    case 'protocol_write':
    case 'protocol_end':
    case 'parser_finish':
      return false;
  }
  throw new Error('Unhandled duplex operation.');
};

export const duplexPrimaryFailureCode = (
  primary: MappedInterimDuplexPrimaryFailure,
): AgentFaultCode => {
  switch (primary.kind) {
    case 'attach_failed':
    case 'stdin_write_failed':
    case 'stdin_end_failed':
    case 'protocol_sink_failed':
      return 'revo.agent.protocol_failed';
    case 'stdout_sink_failed':
    case 'stderr_sink_failed':
      return 'revo.agent.output_write_failed';
    case 'parser_failed':
      return parserFailureCode(primary.reason);
    case 'process_failed':
      return 'revo.agent.process_failed';
    case 'duplex_operation_timeout':
      return isOutputOperation(primary.operation)
        ? 'revo.agent.output_write_failed'
        : 'revo.agent.protocol_failed';
    case 'process_cleanup_failed':
      return 'revo.agent.process_cleanup_failed';
    case 'internal':
      return 'revo.agent.internal';
  }
  throw new Error('Unhandled duplex primary failure.');
};
