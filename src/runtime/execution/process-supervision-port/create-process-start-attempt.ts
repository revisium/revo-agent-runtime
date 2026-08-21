import { PausedProcessIo } from './paused-process-io.js';
import type { ProcessStartAttempt } from './process-start-attempt.js';
import { PROCESS_START_BEGINNERS } from './process-start-beginners.js';
import { PROCESS_START_INVOCATION_TOKENS } from './process-start-invocation-tokens.js';
import type { ProcessStartQuiescence } from './process-start-quiescence.js';
import type { ProcessStartResult } from './process-start-result.js';
import { PROCESS_START_SETTLERS } from './process-start-settlers.js';
import { SpawnAcceptedProcess } from './spawn-accepted-process.js';

type ProcessStartPhase = 'pending' | 'settled';
type ProcessStartCancellationReason = 'caller_cancel' | 'manager_shutdown';
type ProcessStartOutcome =
  | Readonly<{ status: 'accepted'; spawnedAt: number }>
  | Readonly<{ status: 'failed' }>;

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

interface ProcessStartAttemptInput {
  readonly invocationId: string;
}

interface ProcessStartState {
  readonly invocationId: string;
  readonly invocationToken: object;
  readonly settlement: Deferred<ProcessStartResult>;
  readonly quiescence: Deferred<ProcessStartQuiescence>;
  phase: ProcessStartPhase;
  beginStarted: boolean;
  cancellationRequested: ProcessStartCancellationReason | undefined;
}

class InternalProcessStartAttempt implements ProcessStartAttempt {
  readonly #state: ProcessStartState;
  readonly invocationId: string;
  readonly settlement: Promise<ProcessStartResult>;
  readonly quiescence: Promise<ProcessStartQuiescence>;

  constructor(state: ProcessStartState) {
    this.#state = state;
    this.invocationId = state.invocationId;
    this.settlement = state.settlement.promise;
    this.quiescence = state.quiescence.promise;
    PROCESS_START_BEGINNERS.set(this, (dispatch) => beginStart(state, dispatch));
    PROCESS_START_SETTLERS.set(this, (outcome) => handleSettle(state, outcome));
    PROCESS_START_INVOCATION_TOKENS.set(this, state.invocationToken);
    Object.freeze(this);
  }

  requestCancellation(reason: ProcessStartCancellationReason): void {
    this.#state.cancellationRequested ??= reason;
  }
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (resolve === undefined) throw new Error('Unable to allocate process start promise.');
  return Object.freeze({ promise, resolve });
};

export const createProcessStartAttempt = (input: ProcessStartAttemptInput): ProcessStartAttempt => {
  const invocationToken = Object.freeze({});
  const state: ProcessStartState = {
    invocationId: input.invocationId,
    invocationToken,
    settlement: deferred<ProcessStartResult>(),
    quiescence: deferred<ProcessStartQuiescence>(),
    phase: 'pending',
    beginStarted: false,
    cancellationRequested: undefined,
  };

  return new InternalProcessStartAttempt(state);
};

const beginStart = (state: ProcessStartState, dispatch: () => void): void => {
  if (state.phase !== 'pending' || state.beginStarted) return;
  state.beginStarted = true;
  if (state.cancellationRequested !== undefined) {
    settleCancellationBeforeSpawn(state, state.cancellationRequested);
    return;
  }

  try {
    dispatch();
  } catch {
    settleRejectedNotSpawned(state, 'spawn_failed');
  }
};

const settleCancellationBeforeSpawn = (
  state: ProcessStartState,
  reason: ProcessStartCancellationReason,
): void => {
  settleRejectedNotSpawned(
    state,
    reason === 'manager_shutdown' ? 'manager_shutdown_before_spawn' : 'cancelled_before_spawn',
  );
};

const handleSettle = (
  state: ProcessStartState,
  outcome: ProcessStartOutcome,
): ProcessStartResult | undefined => {
  if (state.phase !== 'pending') return undefined;
  state.phase = 'settled';
  if (outcome.status === 'accepted') {
    const result = Object.freeze({
      status: 'spawn_accepted' as const,
      process: SpawnAcceptedProcess.create({
        invocationId: state.invocationId,
        spawnedAt: outcome.spawnedAt,
        invocationToken: state.invocationToken,
      }),
      io: PausedProcessIo.create({
        invocationId: state.invocationId,
        invocationToken: state.invocationToken,
      }),
    });
    state.settlement.resolve(result);
    return result;
  }

  const result = Object.freeze({ status: 'rejected' as const, reason: 'spawn_failed' as const });
  state.settlement.resolve(result);
  state.quiescence.resolve(Object.freeze({ status: 'quiescent', disposition: 'not_spawned' }));
  return result;
};

const settleRejectedNotSpawned = (
  state: ProcessStartState,
  reason: Extract<ProcessStartResult, { status: 'rejected' }>['reason'],
): void => {
  if (state.phase !== 'pending') return;
  state.phase = 'settled';
  state.quiescence.resolve(Object.freeze({ status: 'quiescent', disposition: 'not_spawned' }));
  state.settlement.resolve(Object.freeze({ status: 'rejected', reason }));
};
