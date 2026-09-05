import type { AgentFault } from '../../../../../contracts/manager.js';
import type { SessionProtocolDriver } from '../../../../../protocol/session/port/driver.js';
import type {
  SessionProtocolOpening,
  SessionProtocolOpeningResult,
} from '../../../../../protocol/session/port/opening.js';
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
import { protocolFault } from '../fault.js';
import { mapProtocolCapabilities, mapProtocolInteraction } from '../updates.js';
import { SessionUsageAccumulator } from '../usage.js';
import type { SessionInterpreterResources } from './resources.js';

type ProviderOpenEffect = Extract<SessionEffect, { readonly type: 'provider.open' }>;
type ClosableProvider = Pick<SessionProtocolOpening, 'close'>;

const closeProvider = async (provider: ClosableProvider, reason: string): Promise<void> => {
  try {
    await provider.close(reason);
  } catch {
    // Process cleanup remains the authoritative ownership fence.
  }
};

const timeoutFault = (): AgentFault => ({
  code: 'revo.agent.timeout',
  message: 'Provider session opening timed out.',
  phase: 'session_opening',
  retryable: false,
});

export const createProviderConnectInterpreter = (options: {
  readonly clock: SessionObservationClock;
  readonly driver: SessionProtocolDriver;
  readonly identities: SessionRuntimeIdentitySource;
  readonly resources: SessionInterpreterResources;
  readonly timer?: SessionOperationTimer;
}): SessionEffectHandler<'provider.open'> => ({
  type: 'provider.open',
  execute: (candidate, output): void => {
    if (candidate.type !== 'provider.open') return;
    void connectProvider(candidate, output, options);
  },
});

const connectProvider = async (
  effect: ProviderOpenEffect,
  output: SessionEffectOutput,
  options: {
    readonly clock: SessionObservationClock;
    readonly driver: SessionProtocolDriver;
    readonly identities: SessionRuntimeIdentitySource;
    readonly resources: SessionInterpreterResources;
    readonly timer?: SessionOperationTimer;
  },
): Promise<void> => {
  const preparation = options.resources.preparations.get(effect.preparationId);
  const process = options.resources.processes.get(effect.processResourceId);
  if (preparation === undefined || process === undefined) {
    emitOpenFailure(effect, output, options.clock, protocolFault(undefined, 'session_opening'));
    return;
  }
  const providerResourceId = options.identities.next('provider');
  const observer = {
    update: async (
      update: Parameters<
        Parameters<SessionProtocolDriver['openFresh']>[0]['observer']['update']
      >[0],
    ): Promise<void> => {
      if (update.type !== 'interaction.requested')
        throw new Error('Only interactions are valid during provider opening.');
      const observed = options.clock.now();
      await output.update({
        correlation: effect.correlation,
        observedAt: observed.iso,
        observedAtMs: observed.milliseconds,
        providerResourceId,
        request: mapProtocolInteraction(update.request),
        scope: { kind: 'opening' },
        type: 'provider.interaction_requested',
      });
    },
  };
  let opening: ReturnType<SessionProtocolDriver['openFresh']>;
  try {
    const request = preparation.opening.request;
    const input = request.request;
    const common = {
      ...(input.configuration === undefined ? {} : { configuration: input.configuration }),
      definition: preparation.prepared.definition,
      observer,
      parameters: input.parameters,
      permissions: input.permissions,
      transport: process.transport,
      workspace: input.workspace.directory,
    };
    opening =
      request.kind === 'fresh'
        ? options.driver.openFresh({ ...common, kind: 'fresh' })
        : options.driver.resume({
            ...common,
            continuation: request.continuation,
            kind: 'resume',
          });
  } catch {
    emitOpenFailure(effect, output, options.clock, protocolFault(undefined, 'session_opening'));
    return;
  }
  if (
    !options.resources.providerOpenings.register(
      effect.correlation.effectId,
      providerResourceId,
      opening,
    )
  ) {
    void closeProvider(opening, 'Provider resource identity collision.');
    emitOpenFailure(effect, output, options.clock, protocolFault(undefined, 'session_opening'));
    return;
  }
  const settlement = await settleOperation({
    onTimeout: () => void closeProvider(opening, 'Provider opening timed out.'),
    operation: opening.completion,
    timeoutMs: effect.timeoutMs,
    timer: options.timer ?? systemSessionOperationTimer,
  });
  await emitOpenSettlement(effect, providerResourceId, settlement, output, options);
};

const emitOpenSettlement = async (
  effect: ProviderOpenEffect,
  providerResourceId: string,
  settlement: OperationSettlement<SessionProtocolOpeningResult>,
  output: SessionEffectOutput,
  options: {
    readonly clock: SessionObservationClock;
    readonly resources: SessionInterpreterResources;
  },
): Promise<void> => {
  const opening = options.resources.providerOpenings.take(
    effect.correlation.effectId,
    providerResourceId,
  );
  if (settlement.state !== 'fulfilled' || settlement.phase !== 'initial') {
    if (opening !== undefined)
      await closeProvider(opening, 'Provider opening did not settle in time.');
    emitOpenFailure(effect, output, options.clock, timeoutFault(), true);
    return;
  }
  if (settlement.value.status !== 'opened') {
    if (opening !== undefined) await closeProvider(opening, 'Provider opening failed.');
    emitOpenFailure(
      effect,
      output,
      options.clock,
      protocolFault(settlement.value.failure, 'session_opening'),
    );
    return;
  }
  const preparation = options.resources.preparations.get(effect.preparationId);
  if (
    preparation === undefined ||
    !options.resources.providers.register(providerResourceId, {
      capabilities: settlement.value.capabilities,
      preparation,
      session: settlement.value.session,
      usage: new SessionUsageAccumulator(preparation.opening.usageBaseline),
    })
  ) {
    await closeProvider(settlement.value.session, 'Provider session could not be registered.');
    emitOpenFailure(effect, output, options.clock, protocolFault(undefined, 'session_opening'));
    return;
  }
  const observed = options.clock.now();
  output.outcome({
    capabilities: mapProtocolCapabilities(settlement.value.capabilities),
    correlation: effect.correlation,
    observedAt: observed.iso,
    observedAtMs: observed.milliseconds,
    providerResourceId,
    type: 'provider.opened',
  });
};

const emitOpenFailure = (
  effect: ProviderOpenEffect,
  output: SessionEffectOutput,
  clock: SessionObservationClock,
  fault: AgentFault,
  timedOut = false,
): void => {
  const observed = clock.now();
  output.outcome({
    correlation: effect.correlation,
    fault,
    observedAt: observed.iso,
    observedAtMs: observed.milliseconds,
    type: timedOut ? 'provider.open_timed_out' : 'provider.open_failed',
  });
};
