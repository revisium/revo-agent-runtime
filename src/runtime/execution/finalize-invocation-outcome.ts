import type { InvocationExecutionPorts } from './execution-ports.js';
import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';

const outputFailure = (): NormalizedInvocationOutcome =>
  Object.freeze({ status: 'failed', reason: 'output_write_failed' });

export const finalizeInvocationOutcome = async (
  output: InvocationExecutionPorts['output'],
  outcome: NormalizedInvocationOutcome,
): Promise<NormalizedInvocationOutcome> => {
  try {
    await output.recordTerminalResult(outcome);
    return outcome;
  } catch {
    return outputFailure();
  }
};
