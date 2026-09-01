import { createAgentManager } from '../../../src/application/manager/manager.js';
import type {
  ExecutionOutcome,
  InvocationExecutionRequest,
  InvocationExecutor,
} from '../../../src/execution/invocation/executor.js';
import { agentDefinition } from '../builders/agent-definition.js';
import {
  acceptedAdmission,
  fixtureExecutionEvidence,
  terminalDrainage,
} from '../builders/execution-evidence.js';
import { managerServices } from '../builders/manager-services.js';
import { noOpActiveStateSink } from './active-state.js';

export class InvocationQueryStory {
  private readonly completions = new Map<string, PromiseWithResolvers<ExecutionOutcome>>();
  private startingInvocationId: string | undefined;
  private readonly executor: InvocationExecutor = {
    start: (request) => this.executionFor(request),
  };

  readonly manager = createAgentManager(
    {
      activeStateSink: noOpActiveStateSink,
      definitions: [
        agentDefinition({ id: 'alpha', version: '2.0.0', displayName: 'Alpha' }),
        agentDefinition({
          id: 'zeta',
          version: '1.0.0',
          displayName: 'Zeta',
          description: 'A second agent.',
        }),
      ],
      limits: { maxCompletedInvocations: 1 },
    },
    managerServices({ executor: this.executor }),
  );

  async ready(): Promise<this> {
    await this.manager.initialize([]);
    return this;
  }

  async start(invocationId: string, agentId: 'alpha' | 'zeta' = 'alpha') {
    this.startingInvocationId = invocationId;
    try {
      return await this.manager.start({
        agent: { id: agentId, version: agentId === 'alpha' ? '2.0.0' : '1.0.0' },
        invocationId,
        metadata: { reader: 'query contract' },
        output: { directory: `/fixture/output/${invocationId}` },
        parameters: {},
        permissions: {},
        prompt: 'Return a structured result.',
        result: { schema: { type: 'object' } },
        workspace: { directory: '/fixture/workspace' },
      });
    } finally {
      this.startingInvocationId = undefined;
    }
  }

  complete(invocationId: string, value: Record<string, unknown> = {}): void {
    this.completions.get(invocationId)?.resolve({ status: 'succeeded', value });
  }

  fail(invocationId: string): void {
    this.completions.get(invocationId)?.resolve({ status: 'failed' });
  }

  private executionFor(request: InvocationExecutionRequest) {
    const invocationId = this.startingInvocationId;
    if (invocationId === undefined) throw new Error('The invocation story did not select an id.');
    const completion = Promise.withResolvers<ExecutionOutcome>();
    this.completions.set(invocationId, completion);
    let cancelled = false;
    return {
      admission: Promise.resolve(acceptedAdmission(request)),
      completion: completion.promise,
      drainage: completion.promise.then((outcome) => terminalDrainage(request, outcome)),
      activate: () => {
        if (!cancelled) request.onStarted();
      },
      cancel: () => {
        cancelled = true;
        request.onCancelling();
        completion.resolve({ status: 'cancelled' });
        return true;
      },
      output: () => ({ stderr: new Uint8Array(), stdout: new Uint8Array() }),
      evidence: () => fixtureExecutionEvidence(request),
    };
  }
}
