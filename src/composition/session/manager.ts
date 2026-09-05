import { createSessionOpeningPreparer } from '../../application/session/admission/preparer.js';
import type { AgentSessionComposer } from '../../application/session/management/composition.js';
import { createManagedAgentSessionController } from '../../application/session/management/managed-sessions.js';
import type { OutputClaimPlatform } from '../../execution/output/claim.js';
import type { ClaimedInvocationOutput } from '../../execution/output/claim.js';
import type { SessionOutputPublicationTarget } from '../../execution/output/session/publication.js';
import type { ExecutablePreflight } from '../../execution/probe/executable-preflight.js';
import type { ProcessSpawner, RecoveredProcessInspector } from '../../execution/process/port.js';
import type { Sha256Digest } from '../../execution/security/digest/port.js';
import { composeSessionInterpreters } from '../../execution/session/interpreter/composition/interpreters.js';
import { reduceSession } from '../../execution/session/kernel/reducer/reduce.js';
import { SessionActorFactory } from '../../execution/session/runtime/actor/factory.js';
import { SessionEffectDispatcher } from '../../execution/session/runtime/effects/dispatcher.js';
import { systemSessionClock } from '../../execution/session/runtime/timing/clock.js';
import type { SessionProtocolDriver } from '../../protocol/session/port/driver.js';

export interface SessionComposerServices {
  readonly digest: Sha256Digest;
  readonly driver: SessionProtocolDriver;
  readonly executablePreflight: ExecutablePreflight;
  readonly identities: { next(kind: string): string };
  readonly outputClaimPlatform: OutputClaimPlatform;
  readonly outputTarget: (output: ClaimedInvocationOutput) => SessionOutputPublicationTarget;
  readonly recoveryInspector: RecoveredProcessInspector;
  readonly spawner: ProcessSpawner;
}

export const createAgentSessionComposer = (
  services: SessionComposerServices,
): AgentSessionComposer => {
  const composer: AgentSessionComposer = {
    create: ({ agents, definitions, options }) => {
      const preparer = createSessionOpeningPreparer({
        definitions,
        executablePreflight: services.executablePreflight,
        outputClaimPlatform: services.outputClaimPlatform,
        outputTarget: services.outputTarget,
      });
      const composition = composeSessionInterpreters({
        activeStateSink: options.activeStateSink,
        clock: systemSessionClock,
        digest: services.digest,
        driver: services.driver,
        eventSink: options.eventSink,
        identities: services.identities,
        preparer,
        spawner: services.spawner,
      });
      const runtimeFactory = new SessionActorFactory({
        dispatcher: new SessionEffectDispatcher(composition.interpreters),
        reducer: reduceSession,
      });
      return createManagedAgentSessionController({
        activeStateSink: options.activeStateSink,
        agents,
        clock: systemSessionClock,
        digest: services.digest,
        ...(options.limits === undefined ? {} : { limits: options.limits }),
        nextIdentity: (kind) => services.identities.next(kind),
        recoveryInspector: services.recoveryInspector,
        runtimeFactory,
      });
    },
  };
  return Object.freeze(composer);
};
