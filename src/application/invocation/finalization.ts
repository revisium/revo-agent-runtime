import type {
  AgentEvent,
  AgentExecutionPin,
  AgentInvocationResult,
  StartAgentInvocation,
} from '../../contracts/manager.js';
import type { InvocationExecution } from '../../execution/invocation/executor.js';
import type { ExecutionOutcome } from '../../execution/invocation/terminal.js';
import type { ClaimedInvocationOutput } from '../../execution/output/claim.js';
import type { ClaimedInvocationOutputPublisher } from '../../execution/output/publication.js';
import type { EffectiveLimits } from '../manager/limits.js';
import { buildInvocationResult, type InvocationResultTiming } from '../result/invocation-result.js';

interface TerminalActiveState {
  removeTerminal(): Promise<boolean>;
}

export interface InvocationFinalizationRequest {
  readonly request: StartAgentInvocation;
  readonly pin: AgentExecutionPin;
  readonly outcome: ExecutionOutcome;
  readonly finished: AgentEvent;
  readonly priorEvents: readonly AgentEvent[];
  readonly limits: EffectiveLimits;
  readonly execution: InvocationExecution;
  readonly output: ClaimedInvocationOutput;
  readonly outputPublisher: ClaimedInvocationOutputPublisher;
  readonly activeState: TerminalActiveState;
  readonly timing: Omit<InvocationResultTiming, 'finishedAt'>;
}

export const finalizeInvocation = async ({
  request,
  pin,
  outcome,
  finished,
  priorEvents,
  limits,
  execution,
  output,
  outputPublisher,
  activeState,
  timing,
}: InvocationFinalizationRequest): Promise<AgentInvocationResult | undefined> => {
  const evidence = execution.evidence();
  if (evidence === undefined) return undefined;
  const resultTiming = Object.freeze({ ...timing, finishedAt: finished.timestamp });
  const terminal = buildInvocationResult(request, pin, outcome, evidence, resultTiming);
  if (!(await activeState.removeTerminal())) return undefined;
  const capturedOutput = execution.output?.() ?? {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
  };
  const publication = await outputPublisher.publish(output, {
    events: [...priorEvents, finished],
    maxEventBytes: limits.maxEventBytes,
    maxEventsFileBytes: limits.maxEventsFileBytes,
    stdout: capturedOutput.stdout,
    stderr: capturedOutput.stderr,
    ...(outcome.status === 'failed' && outcome.evidence !== undefined
      ? { rawResponse: outcome.evidence.bytes() }
      : {}),
    result: terminal,
  });
  return publication.status === 'published'
    ? terminal
    : buildInvocationResult(
        request,
        pin,
        {
          status: 'failed',
          code: 'revo.agent.output_write_failed',
          ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
        },
        evidence,
        resultTiming,
        { committed: false, rawPublished: false },
      );
};
