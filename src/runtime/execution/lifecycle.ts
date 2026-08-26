import type { AgentEvent, AgentInvocationResult, JsonObject } from '../spec/index.js';
import type { CancellationCommitOutcome } from './cancellation-commit-outcome.js';
import type { InvocationExecutionPorts } from './execution-ports.js';
import type { InvocationTerminalObservation } from './execution-terminal-observation.js';
import { finalizeInvocationOutcome } from './finalize-invocation-outcome.js';
import { InvocationInputSnapshot } from './input-snapshot.js';
import { normalizeInvocationOutcome } from './normalize-invocation-outcome.js';
import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';
import { getTerminalPublicationInvocationToken } from './output-preparation-attempt/index.js';
import type { TerminalPublicationAuthority } from './output-preparation-attempt/index.js';
import type { PreparedLaunch } from './prepared-launch.js';
import type { ProcessCleanupAttemptOutcome } from './process-supervision-port/index.js';
import type { RunningExecution } from './running-execution.js';

type LifecycleState =
  | 'accepted'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'finalizing'
  | 'terminal';
type CancellationCause = 'caller' | 'deadline';
type ActiveInvocationStatus = 'accepted' | 'starting' | 'running' | 'cancelling';
type LifecycleEventType = Exclude<
  AgentEvent['type'],
  'invocation.accepted' | 'invocation.finished'
>;

const internalFailureObservation = (spawnedAt = Date.now()): InvocationTerminalObservation =>
  Object.freeze({
    status: 'failed',
    spawnedAt,
    exit: Object.freeze({ exitCode: null, signal: null }),
    primary: Object.freeze({ kind: 'internal' }),
  });

const cancelledOrTimedOutOutcome = (
  observation: Extract<InvocationTerminalObservation, { status: 'cancelled' }>,
  cause: CancellationCause | undefined,
  reason: string | undefined,
): NormalizedInvocationOutcome =>
  Object.freeze({
    status: cause !== 'caller' ? ('timed_out' as const) : ('cancelled' as const),
    ...(cause === 'caller' && reason !== undefined ? { reason } : {}),
    evidence: Object.freeze({
      exit: observation.exit,
      ...(observation.usage === undefined ? {} : { usage: observation.usage }),
      ...(observation.rawResponse === undefined ? {} : { rawResponse: observation.rawResponse }),
    }),
  });

interface Deferred<Value = void> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason: unknown) => void;
}

const deferred = <Value = void>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  if (resolve === undefined || reject === undefined)
    throw new Error('Unable to create lifecycle cancellation');
  return { promise, resolve, reject };
};

export class InvocationLifecycle {
  private cancellation: Deferred | undefined;
  private readonly cleanupSettlementDeferred = deferred<
    ProcessCleanupAttemptOutcome | 'confirmed' | 'not_dispatched'
  >();
  private cancellationCause: CancellationCause | undefined;
  private cancellationReason: string | undefined;
  private cancellationDispatched = false;
  private deadlineCancellation: (() => void) | undefined;
  private execution: RunningExecution | undefined;
  private deliveredResult: AgentInvocationResult | undefined;
  private readonly startedAtIso: string;
  private terminalFinishedAtIso: string | undefined;
  private state: LifecycleState = 'accepted';
  private lastActiveStatus: ActiveInvocationStatus = 'accepted';

  constructor(
    private readonly ports: InvocationExecutionPorts,
    private readonly snapshot: InvocationInputSnapshot,
    private readonly preparedLaunch: PreparedLaunch,
    private readonly activateExecution: () => RunningExecution,
    private readonly authority: TerminalPublicationAuthority,
    private readonly acceptedAt: string,
    startedAt: string,
    private readonly saveCancellingState: () => void,
    private readonly removeActiveState: (invocationId: string) => Promise<void>,
    private readonly emitEvent: (type: LifecycleEventType) => void,
    private readonly flushPendingEvidence: () => Promise<boolean>,
    private readonly onTerminal: (result: AgentInvocationResult) => void,
  ) {
    this.startedAtIso = startedAt;
  }

  begin(): void {
    if (this.state === 'accepted') {
      this.state = 'starting';
      this.lastActiveStatus = 'starting';
    } else if (this.state !== 'cancelling') return;
    void this.startExecution();
  }

  requestCancellation(reason?: string): CancellationCommitOutcome {
    return this.requestCancellationFor('caller', reason);
  }

  get cleanupSettlement(): Promise<ProcessCleanupAttemptOutcome | 'confirmed' | 'not_dispatched'> {
    return this.cleanupSettlementDeferred.promise;
  }

  currentState(): LifecycleState {
    return this.state;
  }

  terminalResult(): AgentInvocationResult | undefined {
    return this.deliveredResult;
  }

  terminalFinishedAt(): string | undefined {
    return this.terminalFinishedAtIso;
  }

  startedAt(): string | undefined {
    return this.startedAtIso;
  }

  activeStatus(): ActiveInvocationStatus {
    return this.lastActiveStatus;
  }

  pin(): PreparedLaunch['pin'] {
    return this.preparedLaunch.pin;
  }

  outputDirectory(): string {
    return this.authority.outputDirectory;
  }

  metadata(): JsonObject | undefined {
    return this.snapshot.metadata;
  }

  private async startExecution(): Promise<void> {
    try {
      const execution = this.activateExecution();
      if (this.state === 'terminal' || this.state === 'finalizing') return;
      this.execution = execution;
      // `spawnedAt` is Date.now()-based today, while InvocationClockPort uses an arbitrary monotonic origin.
      const now = Date.now();
      const wallRemaining = Math.max(
        0,
        execution.spawnedAt + this.snapshot.wallClockTimeoutMs - now,
      );
      const idleRemaining = Math.max(
        0,
        execution.spawnedAt + this.snapshot.limits.idleTimeoutMs - now,
      );
      const cancelWall = this.ports.clock.schedule(wallRemaining, () => {
        const outcome = this.requestCancellationFor('deadline');
        if (outcome.status === 'committed') void outcome.completion.catch(() => undefined);
      });
      const cancelIdle = this.ports.clock.schedule(idleRemaining, () => {
        const outcome = this.requestCancellationFor('deadline');
        if (outcome.status === 'committed') void outcome.completion.catch(() => undefined);
      });
      this.deadlineCancellation = () => {
        cancelWall();
        cancelIdle();
      };
      if (this.state === 'starting') {
        this.state = 'running';
        this.lastActiveStatus = 'running';
        this.emitEvent('invocation.started');
      } else if (this.state === 'cancelling') this.dispatchCancellation();
      void execution.completion.then(
        (observation) => this.beginFinalization(observation),
        () => this.beginFinalization(internalFailureObservation(execution.spawnedAt)),
      );
    } catch (error: unknown) {
      this.cancellation?.reject(error);
      this.beginFinalization(internalFailureObservation());
    }
  }

  private requestCancellationFor(
    cause: CancellationCause,
    reason?: string,
  ): CancellationCommitOutcome {
    if (this.state === 'terminal' || this.state === 'finalizing')
      return Object.freeze({ status: 'too_late' as const });
    if (this.cancellation !== undefined)
      return Object.freeze({
        status: 'committed' as const,
        completion: this.cancellation.promise,
      });
    this.cancellationCause = cause;
    this.cancellationReason = reason;
    this.cancellation = deferred();
    this.state = 'cancelling';
    this.lastActiveStatus = 'cancelling';
    this.emitEvent('invocation.cancelling');
    try {
      this.saveCancellingState();
    } catch {
      // Cancelling persistence is diagnostic-only and must not delay local cleanup.
    }
    if (this.execution !== undefined) this.dispatchCancellation();
    return Object.freeze({ status: 'committed' as const, completion: this.cancellation.promise });
  }

  private dispatchCancellation(): void {
    const execution = this.execution;
    const cancellation = this.cancellation;
    if (
      execution === undefined ||
      cancellation === undefined ||
      this.state === 'terminal' ||
      this.state === 'finalizing'
    )
      return;
    this.cancellationDispatched = true;
    void Promise.resolve()
      .then(() => execution.requestCancellation())
      .then(
        (outcome) => {
          this.cleanupSettlementDeferred.resolve(outcome ?? 'confirmed');
          cancellation.resolve(undefined);
        },
        (error: unknown) => {
          this.cleanupSettlementDeferred.resolve(
            Object.freeze({
              cause: 'termination_rejected' as const,
              termSent: false,
              killSent: false,
              lastKnownGroupState: 'unknown' as const,
              leaderReapState: 'unknown' as const,
            }),
          );
          cancellation.reject(error);
          queueMicrotask(() =>
            this.beginFinalization(
              Object.freeze({
                status: 'failed' as const,
                spawnedAt: execution.spawnedAt,
                exit: Object.freeze({ exitCode: null, signal: null }),
                primary: Object.freeze({ kind: 'internal' as const }),
              }),
            ),
          );
        },
      );
  }

  private beginFinalization(observation: InvocationTerminalObservation): void {
    if (this.state === 'terminal' || this.state === 'finalizing') return;
    this.state = 'finalizing';
    this.deadlineCancellation?.();
    if (!this.cancellationDispatched) this.cleanupSettlementDeferred.resolve('not_dispatched');
    void this.finalize(observation);
  }

  private async finalize(observation: InvocationTerminalObservation): Promise<void> {
    let normalized: NormalizedInvocationOutcome;
    try {
      normalized =
        observation.status === 'cancelled'
          ? cancelledOrTimedOutOutcome(observation, this.cancellationCause, this.cancellationReason)
          : normalizeInvocationOutcome(observation, this.preparedLaunch.resultSchemaValidator);
    } catch {
      normalized = Object.freeze({
        status: 'failed',
        failure: Object.freeze({
          kind: 'duplex',
          primary: Object.freeze({ kind: 'internal' }),
          code: 'revo.agent.internal',
        }),
        evidence: Object.freeze({ exit: Object.freeze({ exitCode: null, signal: null }) }),
      });
    }

    const invocationToken = getTerminalPublicationInvocationToken(this.authority);
    const base = Object.freeze({
      schemaVersion: 'agent-invocation-result/v1' as const,
      invocationId: this.snapshot.invocationId,
      pin: this.preparedLaunch.pin,
      launch: Object.freeze({
        executable: this.preparedLaunch.executable,
        reportedVersion: this.preparedLaunch.reportedVersion,
      }),
      ...(this.snapshot.metadata === undefined ? {} : { metadata: this.snapshot.metadata }),
      ...(this.startedAtIso === undefined ? {} : { startedAt: this.startedAtIso }),
      acceptedAt: this.acceptedAt,
      files: Object.freeze({
        directory: this.authority.outputDirectory,
        events: 'events.ndjson' as const,
        stdout: 'stdout.log' as const,
        stderr: 'stderr.log' as const,
      }),
    });
    const cleanupSettlement = await this.cleanupSettlementDeferred.promise;
    if (cleanupSettlement === 'confirmed' || cleanupSettlement === 'not_dispatched') {
      try {
        await this.removeActiveState(this.snapshot.invocationId);
      } catch {
        // Active-row removal is diagnostic-only after confirmed local cleanup.
      }
    }
    const delivered = await finalizeInvocationOutcome({
      output: this.ports.output,
      authority: this.authority,
      flushPendingEvidence: this.flushPendingEvidence,
      invocationToken,
      base,
      normalized,
    });
    this.terminalFinishedAtIso = delivered.finishedAt;
    this.deliveredResult = delivered;
    this.state = 'terminal';
    this.onTerminal(delivered);
  }
}
