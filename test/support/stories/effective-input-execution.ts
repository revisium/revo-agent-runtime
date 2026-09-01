import { createAgentManager } from '../../../src/application/manager/manager.js';
import type { AgentDefinitionInput } from '../../../src/contracts/agent-definition.js';
import type { AgentManager } from '../../../src/contracts/manager.js';
import type { InvocationExecutor } from '../../../src/execution/invocation/executor.js';
import type { ClaimedInvocationOutputPublisher } from '../../../src/execution/output/publication.js';
import {
  acceptedAdmission,
  fixtureExecutionEvidence,
  terminalDrainage,
} from '../builders/execution-evidence.js';
import { managerServices } from '../builders/manager-services.js';
import { noOpActiveStateSink } from './active-state.js';

interface ReceivedEffectiveInputs {
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly permissions: Readonly<Record<string, unknown>>;
}

export interface EffectiveInputExecutionStory {
  readonly manager: AgentManager;
  executionStarts(): number;
  outputPublications(): number;
  receivedInputs(): ReceivedEffectiveInputs | undefined;
}

export const effectiveInputExecutionStory = (
  definitions: readonly AgentDefinitionInput[],
): EffectiveInputExecutionStory => {
  let executionStarts = 0;
  let outputPublications = 0;
  let inputs: ReceivedEffectiveInputs | undefined;
  const executor: InvocationExecutor = {
    start: (request) => {
      executionStarts += 1;
      inputs = Object.freeze({
        parameters: request.parameters,
        permissions: request.permissions,
      });
      const outcome = { status: 'succeeded' as const, value: {} };
      return {
        admission: Promise.resolve(acceptedAdmission(request)),
        completion: Promise.resolve(outcome),
        drainage: Promise.resolve(terminalDrainage(request, outcome)),
        activate: request.onStarted,
        cancel: () => false,
        evidence: () => fixtureExecutionEvidence(request),
      };
    },
  };
  const outputPublisher: ClaimedInvocationOutputPublisher = {
    publish: async () => {
      outputPublications += 1;
      return Object.freeze({
        files: Object.freeze(['events.ndjson', 'stdout.log', 'stderr.log', 'result.json']),
        status: 'published' as const,
      });
    },
  };
  return Object.freeze({
    executionStarts: () => executionStarts,
    manager: createAgentManager(
      {
        activeStateSink: noOpActiveStateSink,
        definitions,
      },
      managerServices({ executor, outputPublisher }),
    ),
    outputPublications: () => outputPublications,
    receivedInputs: () => inputs,
  });
};
