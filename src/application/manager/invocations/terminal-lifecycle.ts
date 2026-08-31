import {
  AgentManagerError,
  type AgentEvent,
  type AgentInvocationResult,
} from '../../../contracts/manager.js';
import type { InvocationExecution } from '../../../execution/invocation/executor.js';
import type { ClaimedInvocationOutputPublisher } from '../../../execution/output/publication.js';
import type { ActiveStateReservation } from '../../active-state/reservation.js';
import { fault } from '../../faults/agent-faults.js';
import { finalizeInvocation } from '../../invocation/finalization.js';
import type { InvocationEvents } from '../invocation-events.js';
import type { EffectiveLimits } from '../limits.js';
import type { PendingInvocationStart } from '../pending-invocation-start.js';
import type { PreparedInvocationStart } from '../prepare-invocation-start.js';

interface AcceptedInvocationLifecycle {
  readonly activeState: ActiveStateReservation;
  readonly completed: (result: AgentInvocationResult, finished: AgentEvent) => void;
  readonly execution: InvocationExecution;
  readonly events: InvocationEvents;
  readonly failed: (error: AgentManagerError) => void;
  readonly limits: EffectiveLimits;
  readonly outputPublisher: ClaimedInvocationOutputPublisher;
  readonly pending: PendingInvocationStart;
  readonly prepared: PreparedInvocationStart;
  readonly acceptedAt: string;
}

export const finalizeAcceptedInvocation = async ({
  acceptedAt,
  activeState,
  completed,
  execution,
  events,
  failed,
  limits,
  outputPublisher,
  pending,
  prepared,
}: AcceptedInvocationLifecycle): Promise<void> => {
  const { pin, request } = prepared.prepared;
  let result: AgentInvocationResult | undefined;
  let finished: AgentEvent | undefined;
  try {
    const outcome = await execution.completion;
    finished = events.finish();
    result = await finalizeInvocation({
      activeState,
      execution,
      finished,
      limits,
      outcome,
      output: prepared.admission.output,
      outputPublisher,
      pin,
      priorEvents: events.priorEvents(),
      request,
      timing: events.timing(acceptedAt),
    });
  } catch {
    pending.dispose();
    failed(
      new AgentManagerError(
        fault(
          'revo.agent.process_cleanup_failed',
          'Agent cleanup evidence could not be confirmed.',
          'finalizing',
        ),
      ),
    );
    return;
  }
  pending.dispose();
  if (result === undefined || finished === undefined) {
    failed(
      new AgentManagerError(
        fault(
          'revo.agent.process_cleanup_failed',
          'Agent cleanup evidence could not be confirmed.',
          'finalizing',
        ),
      ),
    );
    return;
  }
  completed(result, finished);
};
