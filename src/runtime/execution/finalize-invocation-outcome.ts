import type { InvocationExecutionPorts } from './execution-ports.js';
import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';

const outputFailure = (outcome: NormalizedInvocationOutcome): NormalizedInvocationOutcome =>
  Object.freeze({
    status: 'failed',
    failure: Object.freeze({
      kind: 'finalization',
      code: 'revo.agent.output_write_failed',
    }),
    evidence: outcome.evidence,
  });

export const finalizeInvocationOutcome = async (
  output: InvocationExecutionPorts['output'],
  outcome: NormalizedInvocationOutcome,
): Promise<NormalizedInvocationOutcome> => {
  try {
    await output.recordTerminalResult(outcome);
    return outcome;
  } catch {
    return outputFailure(outcome);
  }
};
