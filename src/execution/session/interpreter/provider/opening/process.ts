import type { AgentFault } from '../../../../../contracts/manager.js';
import type { OwnedProcess, ProcessSpawner } from '../../../../process/port.js';
import type { SessionEffect } from '../../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from '../../../runtime/effects/outcomes.js';
import type { SessionRuntimeIdentitySource } from '../../../runtime/primitives/identity.js';
import type { SessionEffectHandler } from '../../shared/effect/handler.js';
import type { SessionObservationClock } from '../../shared/observation/clock.js';
import { settleOperation, type OperationSettlement } from '../../shared/operation/settlement.js';
import {
  systemSessionOperationTimer,
  type SessionOperationTimer,
} from '../../shared/operation/timer.js';
import type { SessionInterpreterResources } from './resources.js';

type ProcessStartEffect = Extract<SessionEffect, { readonly type: 'process.start' }>;

const processFault = (timedOut: boolean): AgentFault => ({
  code: timedOut ? 'revo.agent.timeout' : 'revo.agent.protocol_failed',
  message: timedOut ? 'Session process start timed out.' : 'Session process start failed.',
  phase: 'session_opening',
  retryable: false,
});

export const createProcessStartInterpreter = (options: {
  readonly clock: SessionObservationClock;
  readonly identities: SessionRuntimeIdentitySource;
  readonly resources: SessionInterpreterResources;
  readonly spawner: ProcessSpawner;
  readonly timer?: SessionOperationTimer;
}): SessionEffectHandler<'process.start'> => ({
  type: 'process.start',
  execute: (candidate, output): void => {
    if (candidate.type !== 'process.start') return;
    void startProcess(candidate, output, options);
  },
});

const startProcess = async (
  effect: ProcessStartEffect,
  output: SessionEffectOutput,
  options: {
    readonly clock: SessionObservationClock;
    readonly identities: SessionRuntimeIdentitySource;
    readonly resources: SessionInterpreterResources;
    readonly spawner: ProcessSpawner;
    readonly timer?: SessionOperationTimer;
  },
): Promise<void> => {
  const prepared = options.resources.preparations.get(effect.preparationId);
  if (prepared === undefined) {
    emitProcessFailure(effect, output, options.clock, false);
    return;
  }
  const controller = new AbortController();
  let operation: Promise<OwnedProcess>;
  try {
    operation = options.spawner.start(
      {
        ...prepared.prepared.launch,
        onStderr: (bytes) => prepared.output.writeStderr(bytes),
        onStdout: (bytes) => prepared.output.writeStdout(bytes),
      },
      controller.signal,
    );
  } catch {
    operation = Promise.reject(new Error('Session process start failed synchronously.'));
  }
  const settlement = await settleOperation({
    onTimeout: () => controller.abort(),
    operation,
    timeoutMs: effect.timeoutMs,
    timer: options.timer ?? systemSessionOperationTimer,
  });
  if (settlement.state === 'unknown') {
    void operation.then(
      (process) =>
        emitProcessSettlement(
          effect,
          { phase: 'late', state: 'fulfilled', value: process },
          output,
          options,
        ),
      () => undefined,
    );
  }
  await emitProcessSettlement(effect, settlement, output, options);
};

const emitProcessSettlement = async (
  effect: ProcessStartEffect,
  settlement: OperationSettlement<OwnedProcess>,
  output: SessionEffectOutput,
  options: {
    readonly clock: SessionObservationClock;
    readonly identities: SessionRuntimeIdentitySource;
    readonly resources: SessionInterpreterResources;
  },
): Promise<void> => {
  if (settlement.state !== 'fulfilled') {
    emitProcessFailure(
      effect,
      output,
      options.clock,
      settlement.state === 'unknown' || settlement.phase === 'late',
    );
    return;
  }
  const processResourceId = options.identities.next('process');
  if (!options.resources.processes.register(processResourceId, settlement.value)) {
    try {
      await settlement.value.terminateAndReap();
    } catch {
      // The stable process failure below is the only boundary-visible detail.
    }
    emitProcessFailure(effect, output, options.clock, false);
    return;
  }
  const observed = options.clock.now();
  output.outcome({
    correlation: effect.correlation,
    observedAt: observed.iso,
    observedAtMs: observed.milliseconds,
    process: settlement.value.identity,
    processResourceId,
    type: settlement.phase === 'initial' ? 'process.started' : 'process.late_started',
  });
};

const emitProcessFailure = (
  effect: ProcessStartEffect,
  output: SessionEffectOutput,
  clock: SessionObservationClock,
  timedOut: boolean,
): void => {
  const observed = clock.now();
  output.outcome({
    correlation: effect.correlation,
    fault: processFault(timedOut),
    observedAt: observed.iso,
    observedAtMs: observed.milliseconds,
    type: timedOut ? 'process.timed_out' : 'process.failed',
  });
};
