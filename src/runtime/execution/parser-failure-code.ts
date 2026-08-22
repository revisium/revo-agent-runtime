import type { AgentFaultCode } from '../spec/index.js';
import type { ParserFailureReason } from './result-parser/index.js';

export const parserFailureCode = (reason: ParserFailureReason): AgentFaultCode => {
  switch (reason) {
    case 'response_empty':
      return 'revo.agent.result_missing';
    case 'response_too_large':
      return 'revo.agent.result_too_large';
    case 'invalid_utf8':
    case 'invalid_json':
      return 'revo.agent.result_invalid_json';
    case 'response_not_object':
      return 'revo.agent.result_not_object';
    case 'frame_malformed':
    case 'frame_overflow':
    case 'duplicate_terminal':
      return 'revo.agent.protocol_failed';
    case 'missing_terminal':
      return 'revo.agent.result_missing';
  }
  throw new Error('Unhandled parser failure reason.');
};
