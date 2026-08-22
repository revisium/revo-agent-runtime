import { toAgentFault, type NormalizedInvocationOutcome } from '../../runtime/execution/index.js';
import { AGENT_FAULT_MESSAGES } from '../../runtime/policy/index.js';
import type {
  AgentFault,
  AgentInvocationResult,
  AgentInvocationResultBase,
} from '../../runtime/spec/index.js';

type AgentInvocationResultBaseInput = Omit<AgentInvocationResultBase, 'files'> & {
  readonly files: AgentInvocationResultBase['files'];
};

const cancelledFault = (): AgentFault =>
  Object.freeze({
    code: 'revo.agent.cancelled',
    message: AGENT_FAULT_MESSAGES.cancelled,
    phase: 'running',
    retryable: false,
  });

const timeoutFault = (): AgentFault =>
  Object.freeze({
    code: 'revo.agent.timeout',
    message: AGENT_FAULT_MESSAGES.timeout,
    phase: 'running',
    retryable: false,
  });

const committedFiles = (files: AgentInvocationResultBase['files']) =>
  Object.freeze({ ...files, result: 'result.json' as const });

export const buildAgentInvocationResult = (input: {
  readonly base: AgentInvocationResultBaseInput;
  readonly outcome: NormalizedInvocationOutcome;
}): AgentInvocationResult => {
  const { base, outcome } = input;
  switch (outcome.status) {
    case 'succeeded':
      return Object.freeze({
        ...base,
        files: committedFiles(base.files),
        status: 'succeeded' as const,
        value: outcome.value,
      });
    case 'cancelled':
      return Object.freeze({
        ...base,
        files: committedFiles(base.files),
        status: 'cancelled' as const,
        error: cancelledFault(),
      });
    case 'timed_out':
      return Object.freeze({
        ...base,
        files: committedFiles(base.files),
        status: 'timed_out' as const,
        error: timeoutFault(),
      });
    case 'failed':
      return Object.freeze({
        ...base,
        status: 'failed' as const,
        error: toAgentFault(outcome.failure),
        ...(outcome.evidence.rawResponse === undefined
          ? {}
          : { rawResponse: outcome.evidence.rawResponse.view }),
      });
  }
  throw new Error('Unhandled normalized invocation outcome status.');
};
