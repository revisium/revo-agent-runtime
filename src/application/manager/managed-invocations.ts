import {
  AgentManagerError,
  type ActiveInvocationStateSink,
  type AgentInvocationHandle,
  type AgentInvocationResult,
  type AgentStartContext,
  type CancelInvocationResult,
  type StartAgentInvocation,
} from '../../contracts/manager.js';
import type { SealedAgentRegistry } from '../../definition/index.js';
import type {
  InvocationExecution,
  InvocationExecutor,
} from '../../execution/invocation/executor.js';
import type { OutputClaimPlatform } from '../../execution/output/claim.js';
import type { ClaimedInvocationOutputPublisher } from '../../execution/output/publication.js';
import type { ExecutablePreflight } from '../../execution/probe/executable-preflight.js';
import type { ProcessIdentity } from '../../execution/process/port.js';
import { ActiveStateReservation } from '../active-state/reservation.js';
import { activeStateError, fault, preacceptanceError } from '../faults/agent-faults.js';
import type { EffectiveInvocationInputPolicy } from '../invocation/input/effective-invocation-inputs.js';
import { prepareInvocationRequest } from '../invocation/preflight.js';
import type { EventSubscriptions } from './events.js';
import { InvocationEvents } from './invocation-events.js';
import type { InvocationQueries } from './invocation-queries.js';
import { finalizeAcceptedInvocation } from './invocations/terminal-lifecycle.js';
import type { EffectiveLimits } from './limits.js';
import { PendingInvocationStart } from './pending-invocation-start.js';
import type { PendingOperations } from './pending-operations.js';
import {
  prepareInvocationStart,
  type PreparedInvocationStart,
} from './prepare-invocation-start.js';
import { startInvocationExecution } from './start-invocation-execution.js';

interface ManagedInvocationServices {
  readonly activeStateSink: ActiveInvocationStateSink;
  readonly definitions: SealedAgentRegistry;
  readonly executor: InvocationExecutor;
  readonly executablePreflight: ExecutablePreflight;
  readonly inputPolicy: EffectiveInvocationInputPolicy;
  readonly isClosed: () => boolean;
  readonly limits: EffectiveLimits;
  readonly outputClaimPlatform: OutputClaimPlatform;
  readonly outputPublisher: ClaimedInvocationOutputPublisher;
  readonly pendingOperations: PendingOperations;
  readonly queries: InvocationQueries;
  readonly redactionSecrets: readonly string[];
  readonly subscriptions: EventSubscriptions;
}

/** Owns accepted invocation state and the complete start-to-terminal use case. */
export class ManagedInvocations {
  private readonly active = new Map<string, InvocationExecution>();
  private readonly pending = new Map<string, PendingInvocationStart>();
  private readonly unresolvedPreacceptance = new Set<string>();
  private readonly terminalizationFailures = new Set<string>();
  private readonly stateReservations = new Map<string, ActiveStateReservation>();
  private readonly finalizations = new Map<string, Promise<void>>();

  constructor(private readonly services: ManagedInvocationServices) {}

  async start(
    value: StartAgentInvocation,
    context?: AgentStartContext,
  ): Promise<AgentInvocationHandle> {
    const prepared = prepareInvocationRequest(
      value,
      this.services.definitions,
      this.services.limits,
    );
    this.assertAvailable(prepared.request.invocationId);
    const pending = new PendingInvocationStart(context, this.services.pendingOperations);
    this.pending.set(prepared.request.invocationId, pending);
    let accepted = false;
    let cleanupUncertain = false;
    try {
      const start = await prepareInvocationStart(prepared, context, pending.signal, {
        executablePreflight: this.services.executablePreflight,
        inputPolicy: this.services.inputPolicy,
        outputClaimPlatform: this.services.outputClaimPlatform,
      });
      const events = new InvocationEvents(
        prepared.request.invocationId,
        prepared.pin,
        this.services.queries,
        this.services.subscriptions,
      );
      const execution = startInvocationExecution(
        this.services.executor,
        start,
        events,
        this.services.redactionSecrets,
      );
      pending.bindExecution(execution);
      const admission = await execution.admission;
      if (admission.status === 'rejected') {
        cleanupUncertain = admission.cleanup === 'uncertain';
        throw preacceptanceError(admission.outcome, admission.cleanup);
      }
      const activeState = await this.saveActiveState(
        start,
        execution,
        events,
        admission.identity,
        pending,
        () => {
          cleanupUncertain = true;
        },
      );
      if (this.services.isClosed() || context?.signal?.aborted === true) {
        const cleanup = await this.drainBeforeAcceptance(execution, activeState);
        if (cleanup.process === 'uncertain' || !cleanup.stateRemoved) cleanupUncertain = true;
        throw preacceptanceError({ status: 'cancelled' }, cleanup.process);
      }
      const handle = this.accept(start, execution, activeState, events, pending);
      accepted = true;
      return handle;
    } finally {
      if (!accepted) {
        if (cleanupUncertain) this.unresolvedPreacceptance.add(prepared.request.invocationId);
        this.releasePending(prepared.request.invocationId, pending);
        pending.dispose();
      }
    }
  }

  cancel(invocationId: string): CancelInvocationResult {
    const lookup = this.services.queries.getResult(invocationId);
    if (lookup.state === 'completed')
      return Object.freeze({ result: lookup.result, state: 'already_completed' });
    const invocation = this.active.get(invocationId);
    if (invocation === undefined) return Object.freeze({ state: 'unknown' });
    invocation.cancel();
    return Object.freeze({ state: 'requested' });
  }

  cancelAll(): void {
    for (const invocationId of this.active.keys()) this.cancel(invocationId);
  }

  async quiesce(): Promise<boolean> {
    const processDrainage = await Promise.all(
      [...this.active.values()].map((execution) => execution.drainage),
    );
    const stateDrainage = await Promise.all(
      [...this.stateReservations.values()].map((reservation) => reservation.quiesce()),
    );
    if (
      processDrainage.some((outcome) => outcome.status === 'cleanup_uncertain') ||
      stateDrainage.some((outcome) => outcome === 'unknown') ||
      this.unresolvedPreacceptance.size > 0 ||
      this.terminalizationFailures.size > 0
    )
      return false;
    await Promise.all([...this.finalizations.values()]);
    return this.pending.size === 0 && this.active.size === 0;
  }

  private assertAvailable(invocationId: string): void {
    if (
      this.pending.has(invocationId) ||
      this.unresolvedPreacceptance.has(invocationId) ||
      this.active.has(invocationId) ||
      this.services.queries.has(invocationId)
    )
      throw new AgentManagerError(
        fault(
          'revo.agent.invocation_duplicate',
          'Agent invocation id is already reserved.',
          'preflight',
        ),
      );
  }

  private async saveActiveState(
    start: PreparedInvocationStart,
    execution: InvocationExecution,
    events: InvocationEvents,
    identity: ProcessIdentity,
    pending: PendingInvocationStart,
    markCleanupUncertain: () => void,
  ): Promise<ActiveStateReservation> {
    const { pin, request } = start.prepared;
    const activeState = new ActiveStateReservation(
      request.invocationId,
      pin,
      identity,
      this.services.activeStateSink,
      start.prepared.limits.activeStateOperationTimeoutMs,
      () => this.releasePreacceptance(request.invocationId, pending),
    );
    this.stateReservations.set(request.invocationId, activeState);
    events.bindActiveState(activeState);
    if (await activeState.saveRunning()) return activeState;

    const cleanup = await this.drainBeforeAcceptance(execution, activeState);
    if (!cleanup.stateRemoved) markCleanupUncertain();
    if (cleanup.process === 'uncertain') {
      markCleanupUncertain();
      throw preacceptanceError({ status: 'failed' }, 'uncertain');
    }
    throw activeStateError('preflight');
  }

  private async drainBeforeAcceptance(
    execution: InvocationExecution,
    activeState: ActiveStateReservation,
  ): Promise<Readonly<{ process: 'confirmed' | 'uncertain'; stateRemoved: boolean }>> {
    execution.cancel();
    execution.activate();
    const drainage = await execution.drainage;
    const process = drainage.status === 'terminal' ? 'confirmed' : 'uncertain';
    const stateRemoved = await activeState.removeBeforeAcceptance(process === 'confirmed');
    return Object.freeze({ process, stateRemoved });
  }

  private accept(
    start: PreparedInvocationStart,
    execution: InvocationExecution,
    activeState: ActiveStateReservation,
    events: InvocationEvents,
    pending: PendingInvocationStart,
  ): AgentInvocationHandle {
    const { limits, pin, request } = start.prepared;
    let resolveResult!: (result: AgentInvocationResult) => void;
    let rejectResult!: (reason: AgentManagerError) => void;
    const result = new Promise<AgentInvocationResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const accepted = events.accept(request, result);
    this.active.set(request.invocationId, execution);
    this.releasePending(request.invocationId, pending);
    events.publishAccepted(accepted);

    const finalization = finalizeAcceptedInvocation({
      acceptedAt: accepted.timestamp,
      activeState,
      execution,
      events,
      limits,
      outputPublisher: this.services.outputPublisher,
      pending,
      prepared: start,
      completed: (delivered, finished) => {
        this.services.queries.complete(request.invocationId, delivered, finished.timestamp);
        this.active.delete(request.invocationId);
        this.stateReservations.delete(request.invocationId);
        this.services.subscriptions.publish(finished);
        resolveResult(delivered);
      },
      failed: (error) => {
        this.terminalizationFailures.add(request.invocationId);
        rejectResult(error);
      },
    });
    this.finalizations.set(request.invocationId, finalization);
    void finalization.finally(() => this.finalizations.delete(request.invocationId));
    execution.activate();
    return Object.freeze({
      cancel: () => Promise.resolve(this.cancel(request.invocationId)),
      invocationId: request.invocationId,
      pin,
      result: () => result,
    });
  }

  private releasePending(invocationId: string, pending: PendingInvocationStart): void {
    if (this.pending.get(invocationId) !== pending) return;
    this.pending.delete(invocationId);
    pending.finishPending();
  }

  private releasePreacceptance(invocationId: string, pending: PendingInvocationStart): void {
    this.stateReservations.delete(invocationId);
    this.unresolvedPreacceptance.delete(invocationId);
    this.releasePending(invocationId, pending);
  }
}
