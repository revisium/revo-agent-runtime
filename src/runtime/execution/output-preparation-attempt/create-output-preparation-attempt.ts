import type { InvocationClockPort } from '../invocation-clock-port.js';
import {
  isClaimedInvocationOutput,
  type ClaimedInvocationOutput,
} from '../output-claim-attempt/index.js';
import type { ConsumedOutputPreparationMaterial } from './consumed-output-preparation-material.js';
import type { ConsumedRedactionMaterial } from './consumed-redaction-material.js';
import type { OutputPreparationAttempt } from './output-preparation-attempt.js';
import { OUTPUT_PREPARATION_BEGINNERS } from './output-preparation-beginners.js';
import { OUTPUT_PREPARATION_INVOCATION_TOKENS } from './output-preparation-invocation-tokens.js';
import type { OutputPreparationMutationPort } from './output-preparation-mutation-port.js';
import type { OutputPreparationPlatformResult } from './output-preparation-platform-result.js';
import type { OutputPreparationQuiescence } from './output-preparation-quiescence.js';
import type { OutputPreparationResult } from './output-preparation-result.js';
import { PreparedInvocationResources } from './prepared-invocation-resources.js';
import { TerminalPublicationAuthority } from './terminal-publication-authority.js';

const PREPARATION_DEADLINE_MS = 10_000;

type PreparationPhase = 'pending' | 'retained' | 'settled';

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

interface OutputPreparationAttemptInput {
  readonly session: ClaimedInvocationOutput;
  readonly clock: InvocationClockPort;
  readonly port: OutputPreparationMutationPort;
}

interface PreparationState {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly invocationToken: object;
  readonly port: OutputPreparationMutationPort;
  readonly authority: TerminalPublicationAuthority;
  readonly settlement: Deferred<OutputPreparationResult>;
  readonly quiescence: Deferred<OutputPreparationQuiescence>;
  readonly platformOutcome: Deferred<PreparationPlatformOutcome>;
  readonly cancelDeadline: () => void;
  phase: PreparationPhase;
  beginStarted: boolean;
  cancellationRequested: boolean;
  mutationDispatched: boolean;
}

class InternalOutputPreparationAttempt implements OutputPreparationAttempt {
  readonly #invocationToken: object;
  readonly #state: PreparationState;
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly authority: TerminalPublicationAuthority;
  readonly settlement: Promise<OutputPreparationResult>;
  readonly quiescence: Promise<OutputPreparationQuiescence>;

  constructor(state: PreparationState) {
    this.#invocationToken = state.invocationToken;
    this.#state = state;
    this.invocationId = state.invocationId;
    this.outputDirectory = state.outputDirectory;
    this.authority = state.authority;
    this.settlement = state.settlement.promise;
    this.quiescence = state.quiescence.promise;
    Object.freeze(this.#invocationToken);
    OUTPUT_PREPARATION_BEGINNERS.set(this, (material, redaction) =>
      beginPreparation(state, material, redaction),
    );
    OUTPUT_PREPARATION_INVOCATION_TOKENS.set(this, state.invocationToken);
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
  if (resolve === undefined) throw new Error('Unable to allocate output preparation promise.');
  return Object.freeze({ promise, resolve });
};

export const createOutputPreparationAttempt = (
  input: OutputPreparationAttemptInput,
): OutputPreparationAttempt | undefined => {
  if (!isClaimedInvocationOutput(input.session)) return undefined;

  const invocationToken = Object.freeze({});
  const authority = TerminalPublicationAuthority.create({
    invocationId: input.session.invocationId,
    outputDirectory: input.session.outputDirectory,
    invocationToken,
  });
  const settlement = deferred<OutputPreparationResult>();
  const quiescence = deferred<OutputPreparationQuiescence>();
  const platformOutcome = deferred<PreparationPlatformOutcome>();
  const state: PreparationState = {
    invocationId: input.session.invocationId,
    outputDirectory: input.session.outputDirectory,
    invocationToken,
    port: input.port,
    authority,
    settlement,
    quiescence,
    platformOutcome,
    cancelDeadline: () => undefined,
    phase: 'pending',
    beginStarted: false,
    cancellationRequested: false,
    mutationDispatched: false,
  };
  const cancelDeadline = input.clock.schedule(PREPARATION_DEADLINE_MS, () => {
    settlePreparationTimeout(state);
  });
  Object.defineProperty(state, 'cancelDeadline', { value: cancelDeadline });
  void platformOutcome.promise.then((result) => settlePlatformResult(state, result));

  return new InternalOutputPreparationAttempt(state);
};

const beginPreparation = (
  state: PreparationState,
  material: ConsumedOutputPreparationMaterial,
  redaction: ConsumedRedactionMaterial,
): void => {
  if (state.phase !== 'pending' || state.beginStarted) return;
  state.beginStarted = true;
  if (state.cancellationRequested) {
    settleRejected(state, 'cancelled_before_mutation', false);
    return;
  }

  let platformSettlement: Promise<OutputPreparationPlatformResult>;
  try {
    const prepared = state.port.prepareClaimedOutput({
      invocationId: state.invocationId,
      outputDirectory: state.outputDirectory,
      material,
      redaction,
      markMutationDispatched: () => {
        state.mutationDispatched = true;
      },
    });
    if (typeof prepared?.then !== 'function') {
      throw new TypeError('Output preparation mutation port did not return a promise.');
    }
    platformSettlement = prepared;
  } catch {
    settleSynchronousFailure(state);
    return;
  }

  void platformSettlement.then(
    (result) => state.platformOutcome.resolve(result),
    () => state.platformOutcome.resolve({ status: 'unknown_failure' }),
  );
};

const settleSynchronousFailure = (state: PreparationState): void => {
  if (state.mutationDispatched) {
    settleUncertain(state, 'preparation_state_unknown');
    return;
  }
  settleRejected(state, 'internal_before_mutation', false);
};

type PreparationPlatformOutcome =
  | OutputPreparationPlatformResult
  | Readonly<{ status: 'unknown_failure' }>;

const settlePlatformResult = (
  state: PreparationState,
  result: PreparationPlatformOutcome,
): void => {
  if (state.phase !== 'pending') return;
  if (result.status === 'prepared') {
    settlePrepared(state, result);
    return;
  }
  if (result.status === 'rejected') {
    settleRejected(state, result.reason, state.mutationDispatched);
    return;
  }
  // Raw adapter rejection is a package defect, not a platform step diagnosis; split by dispatch instead of inventing a seventh platform reason.
  settleSynchronousFailure(state);
};

const settlePreparationTimeout = (state: PreparationState): void => {
  settleUncertain(state, 'preparation_timeout');
};

const settlePrepared = (
  state: PreparationState,
  result: Extract<OutputPreparationPlatformResult, { status: 'prepared' }>,
): void => {
  settleBoth(
    state,
    Object.freeze({
      status: 'prepared',
      resources: PreparedInvocationResources.create({
        ...state,
        attestations: result.attestations,
        frontEnds: result.frontEnds,
        evidenceSinks: result.evidenceSinks,
      }),
      authority: state.authority,
    }),
    Object.freeze({ status: 'quiescent', mutationDispatched: true }),
  );
};

const settleRejected = (
  state: PreparationState,
  reason: Extract<OutputPreparationResult, { status: 'rejected' }>['reason'],
  mutationDispatched: boolean,
): void => {
  settleBoth(
    state,
    Object.freeze({ status: 'rejected', reason, authority: state.authority }),
    Object.freeze({ status: 'quiescent', mutationDispatched }),
  );
};

const settleUncertain = (
  state: PreparationState,
  reason: Extract<OutputPreparationResult, { status: 'uncertain' }>['reason'],
): void => {
  settleRetained(state, reason);
};

const settleRetained = (
  state: PreparationState,
  reason: Extract<OutputPreparationResult, { status: 'uncertain' }>['reason'],
): void => {
  if (state.phase !== 'pending') return;
  state.phase = 'retained';
  state.cancelDeadline();
  state.quiescence.resolve(Object.freeze({ status: 'retained', authority: state.authority }));
  state.settlement.resolve(
    Object.freeze({ status: 'uncertain', reason, authority: state.authority }),
  );
};

const settleBoth = (
  state: PreparationState,
  result: OutputPreparationResult,
  quiescence: OutputPreparationQuiescence,
): void => {
  if (state.phase !== 'pending') return;
  state.phase = 'settled';
  state.cancelDeadline();
  state.quiescence.resolve(quiescence);
  state.settlement.resolve(result);
};
