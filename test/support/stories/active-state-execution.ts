import type { StartAgentInvocation } from '../../../src/contracts/manager.js';
import type {
  ExecutionAdmission,
  ExecutionOutcome,
  InvocationExecutionRequest,
  InvocationExecutor,
} from '../../../src/execution/invocation/executor.js';
import {
  acceptedAdmission,
  fixtureExecutionEvidence,
  terminalDrainage,
} from '../builders/execution-evidence.js';

export const activeStateRequest = (invocationId: string): StartAgentInvocation => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId,
  output: { directory: '/fixture/output' },
  parameters: {},
  permissions: {},
  prompt: 'Return a result.',
  result: { schema: { type: 'object' } },
  workspace: { directory: '/fixture/workspace' },
});

export interface ActiveExecutionStory {
  readonly executor: InvocationExecutor;
  acceptProcess(): Promise<void>;
  cancellations(): number;
  complete(outcome?: ExecutionOutcome): void;
  waitUntilExecutionStarted(): Promise<void>;
}

export const activeExecutionStory = (
  admissionMode: 'immediate' | 'controlled' = 'immediate',
): ActiveExecutionStory => {
  const admission = Promise.withResolvers<ExecutionAdmission>();
  const completion = Promise.withResolvers<ExecutionOutcome>();
  const executionStarted = Promise.withResolvers<void>();
  let request: InvocationExecutionRequest | undefined;
  let cancellations = 0;
  let cancellationNotified = false;

  return {
    acceptProcess: async () => {
      await executionStarted.promise;
      if (request === undefined) throw new Error('Execution has not started.');
      admission.resolve(acceptedAdmission(request));
    },
    executor: {
      start: (received) => {
        request = received;
        executionStarted.resolve();
        if (admissionMode === 'immediate') admission.resolve(acceptedAdmission(received));
        const evidence = fixtureExecutionEvidence(received);
        return {
          admission: admission.promise,
          completion: completion.promise,
          drainage: completion.promise.then((outcome) => terminalDrainage(received, outcome)),
          activate: received.onStarted,
          cancel: () => {
            cancellations += 1;
            if (!cancellationNotified) {
              cancellationNotified = true;
              received.onCancelling();
            }
            completion.resolve({ status: 'cancelled' });
            return true;
          },
          evidence: () => evidence,
          output: () => ({ stderr: new Uint8Array(), stdout: new Uint8Array() }),
        };
      },
    },
    cancellations: () => cancellations,
    complete: (outcome = { status: 'succeeded', value: {} }) => {
      if (request === undefined) throw new Error('Execution has not started.');
      completion.resolve(outcome);
    },
    waitUntilExecutionStarted: () => executionStarted.promise,
  };
};
