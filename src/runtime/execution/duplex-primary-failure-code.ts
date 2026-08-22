import type { AgentFaultCode } from '../spec/index.js';
import type { InterimDuplexPrimaryFailure } from './interim-duplex-primary-failure.js';
import { parserFailureCode } from './parser-failure-code.js';

export const duplexPrimaryFailureCode = (primary: InterimDuplexPrimaryFailure): AgentFaultCode => {
  switch (primary.kind) {
    case 'attach_failed':
    case 'stdin_write_failed':
    case 'stdin_end_failed':
      return 'revo.agent.protocol_failed';
    case 'parser_failed':
      return parserFailureCode(primary.reason);
    case 'process_failed':
      return 'revo.agent.process_failed';
    case 'internal':
      return 'revo.agent.internal';
  }
  throw new Error('Unhandled duplex primary failure.');
};
