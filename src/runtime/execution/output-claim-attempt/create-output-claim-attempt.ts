import type { InvocationExecutionPorts } from '../execution-ports.js';
import { ClaimedInvocationOutput } from './claimed-invocation-output.js';
import type { OutputClaimAttempt } from './output-claim-attempt.js';
import { OUTPUT_CLAIM_BEGINNERS } from './output-claim-beginners.js';
import type { OutputClaimExclusiveCreatePort } from './output-claim-exclusive-create-port.js';
import { OutputClaimGuard } from './output-claim-guard.js';
import type { OutputClaimPlatformResult } from './output-claim-platform-result.js';
import type { OutputClaimQuiescence } from './output-claim-quiescence.js';
import type { OutputClaimResult } from './output-claim-result.js';

const CLAIM_DEADLINE_MS = 10_000;

type ClaimPhase = 'pending' | 'retained' | 'settled';

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

interface OutputClaimAttemptInput {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly clock: InvocationExecutionPorts['clock'];
  readonly port: OutputClaimExclusiveCreatePort;
}

interface ClaimState {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly port: OutputClaimExclusiveCreatePort;
  readonly guard: OutputClaimGuard;
  readonly settlement: Deferred<OutputClaimResult>;
  readonly quiescence: Deferred<OutputClaimQuiescence>;
  readonly platformOutcome: Deferred<ClaimPlatformOutcome>;
  readonly cancelDeadline: () => void;
  phase: ClaimPhase;
  beginStarted: boolean;
  cancellationRequested: boolean;
  dispatchStarted: boolean;
}

class InternalOutputClaimAttempt implements OutputClaimAttempt {
  readonly #state: ClaimState;
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly settlement: Promise<OutputClaimResult>;
  readonly quiescence: Promise<OutputClaimQuiescence>;

  constructor(state: ClaimState) {
    this.#state = state;
    this.invocationId = state.invocationId;
    this.outputDirectory = state.outputDirectory;
    this.settlement = state.settlement.promise;
    this.quiescence = state.quiescence.promise;
    OUTPUT_CLAIM_BEGINNERS.set(this, () => beginClaim(state));
    Object.freeze(this);
  }

  requestCancellation(): void {
    this.#state.cancellationRequested = true;
  }
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (resolve === undefined) throw new Error('Unable to allocate output claim promise.');
  return Object.freeze({ promise, resolve });
};

export const createOutputClaimAttempt = (input: OutputClaimAttemptInput): OutputClaimAttempt => {
  const settlement = deferred<OutputClaimResult>();
  const quiescence = deferred<OutputClaimQuiescence>();
  const guard = OutputClaimGuard.create(input);
  const platformOutcome = deferred<ClaimPlatformOutcome>();
  const state: ClaimState = {
    invocationId: input.invocationId,
    outputDirectory: input.outputDirectory,
    port: input.port,
    guard,
    settlement,
    quiescence,
    platformOutcome,
    cancelDeadline: () => undefined,
    phase: 'pending',
    beginStarted: false,
    cancellationRequested: false,
    dispatchStarted: false,
  };
  const cancelDeadline = input.clock.schedule(CLAIM_DEADLINE_MS, () => {
    settleClaimTimeout(state);
  });
  Object.defineProperty(state, 'cancelDeadline', { value: cancelDeadline });
  void platformOutcome.promise.then((result) => settlePlatformResult(state, result));

  return new InternalOutputClaimAttempt(state);
};
const beginClaim = (state: ClaimState): void => {
  if (state.phase !== 'pending' || state.beginStarted) return;
  state.beginStarted = true;
  if (state.cancellationRequested) {
    settleRejected(state, 'cancelled_before_dispatch', false);
    return;
  }

  let platformSettlement: Promise<OutputClaimPlatformResult>;
  try {
    const created = state.port.createExclusiveOutputDirectory({
      invocationId: state.invocationId,
      outputDirectory: state.outputDirectory,
      markSyscallDispatched: () => {
        state.dispatchStarted = true;
      },
    });
    if (typeof created?.then !== 'function') {
      throw new TypeError('Output claim exclusive-create port did not return a promise.');
    }
    platformSettlement = created;
  } catch {
    settleSynchronousFailure(state);
    return;
  }

  void platformSettlement.then(
    (result) => state.platformOutcome.resolve(result),
    () => state.platformOutcome.resolve({ status: 'unknown_failure' }),
  );
};

const settleSynchronousFailure = (state: ClaimState): void => {
  if (state.dispatchStarted) {
    settleUncertain(state, 'claim_state_unknown');
    return;
  }
  settleRejected(state, 'internal_before_dispatch', false);
};

type ClaimPlatformOutcome = OutputClaimPlatformResult | Readonly<{ status: 'unknown_failure' }>;

const settlePlatformResult = (state: ClaimState, result: ClaimPlatformOutcome): void => {
  if (state.phase === 'retained') {
    reconcileRetainedClaim(state, result);
    return;
  }
  if (state.phase !== 'pending') return;
  if (result.status === 'created') {
    settleClaimed(state);
    return;
  }
  settleRejected(state, result.status === 'leaf_exists' ? 'leaf_exists' : 'create_failed', true);
};

const reconcileRetainedClaim = (state: ClaimState, result: ClaimPlatformOutcome): void => {
  if (result.status === 'created') {
    OutputClaimGuard.reconcile(
      state.guard,
      Object.freeze({ status: 'claimed', session: ClaimedInvocationOutput.create(state) }),
    );
    return;
  }
  if (result.status === 'leaf_exists' || result.status === 'create_failed') {
    OutputClaimGuard.reconcile(state.guard, Object.freeze({ status: 'absent' }));
    return;
  }
  OutputClaimGuard.reconcile(
    state.guard,
    Object.freeze({ status: 'unknown', reason: 'unreconciled' }),
  );
};

const settleClaimTimeout = (state: ClaimState): void => {
  settleRetained(state, 'claim_timeout');
};

const settleClaimed = (state: ClaimState): void => {
  settleBoth(
    state,
    Object.freeze({ status: 'claimed', session: ClaimedInvocationOutput.create(state) }),
    Object.freeze({ status: 'quiescent', syscallDispatched: true }),
  );
};

const settleRejected = (
  state: ClaimState,
  reason: Extract<OutputClaimResult, { status: 'rejected' }>['reason'],
  syscallDispatched: boolean,
): void => {
  settleBoth(
    state,
    Object.freeze({ status: 'rejected', reason }),
    Object.freeze({ status: 'quiescent', syscallDispatched }),
  );
};

const settleUncertain = (
  state: ClaimState,
  reason: Extract<OutputClaimResult, { status: 'uncertain' }>['reason'],
): void => {
  settleRetained(state, reason);
};

const settleRetained = (
  state: ClaimState,
  reason: Extract<OutputClaimResult, { status: 'uncertain' }>['reason'],
): void => {
  if (state.phase !== 'pending') return;
  state.phase = 'retained';
  state.cancelDeadline();
  state.quiescence.resolve(Object.freeze({ status: 'retained', guard: state.guard }));
  state.settlement.resolve(Object.freeze({ status: 'uncertain', reason, guard: state.guard }));
};

const settleBoth = (
  state: ClaimState,
  result: OutputClaimResult,
  quiescence: OutputClaimQuiescence,
): void => {
  if (state.phase !== 'pending') return;
  state.phase = 'settled';
  state.cancelDeadline();
  state.quiescence.resolve(quiescence);
  state.settlement.resolve(result);
};
