import type { AgentSessionEventSink } from '../../../../contracts/session/events/sink.js';
import type { ActiveAgentSessionStateSink } from '../../../../contracts/session/persistence/active-state.js';
import type { SessionProtocolDriver } from '../../../../protocol/session/port/driver.js';
import type { ProcessSpawner } from '../../../process/port.js';
import type { Sha256Digest } from '../../../security/digest/port.js';
import type { SessionEffect } from '../../kernel/effect/session-effect.js';
import type { SessionOpeningPreparer } from '../../port/opening-preparation.js';
import type { SessionRuntimeIdentitySource } from '../../runtime/primitives/identity.js';
import { createCheckpointCaptureInterpreter } from '../checkpoint/capture.js';
import { createEventAppendInterpreter } from '../event/deliver.js';
import { createOutputPublicationInterpreter } from '../output/publish.js';
import { createActiveStateInterpreters } from '../persistence/active-state.js';
import { createProcessCleanupInterpreter } from '../process/cleanup.js';
import { createProviderInteractionInterpreter } from '../provider/interaction.js';
import { createProviderLifecycleInterpreters } from '../provider/lifecycle.js';
import { createProviderOpeningInterpreters } from '../provider/opening.js';
import {
  createSessionInterpreterResources,
  type SessionInterpreterResources,
} from '../provider/opening/resources.js';
import { createProviderTurnInterpreter } from '../provider/turn.js';
import type { SessionEffectHandler } from '../shared/effect/handler.js';
import type { SessionObservationClock } from '../shared/observation/clock.js';
import type { SessionOperationTimer } from '../shared/operation/timer.js';

export interface SessionInterpreterCompositionOptions {
  readonly activeStateSink: ActiveAgentSessionStateSink;
  readonly clock: SessionObservationClock;
  readonly digest: Sha256Digest;
  readonly driver: SessionProtocolDriver;
  readonly eventSink: AgentSessionEventSink;
  readonly identities: SessionRuntimeIdentitySource;
  readonly preparer: SessionOpeningPreparer;
  readonly resources?: SessionInterpreterResources;
  readonly spawner: ProcessSpawner;
  readonly timer?: SessionOperationTimer;
}

export interface SessionInterpreterComposition {
  readonly interpreters: readonly SessionEffectHandler<
    Exclude<
      SessionEffect['type'],
      'public.resolve' | 'public.reject' | 'timer.schedule' | 'timer.cancel'
    >
  >[];
  readonly resources: SessionInterpreterResources;
}

export const composeSessionInterpreters = (
  options: SessionInterpreterCompositionOptions,
): SessionInterpreterComposition => {
  const resources = options.resources ?? createSessionInterpreterResources();
  const shared = {
    clock: options.clock,
    resources,
    ...(options.timer === undefined ? {} : { timer: options.timer }),
  };
  const persistence = createActiveStateInterpreters({
    clock: options.clock,
    sink: options.activeStateSink,
    ...(options.timer === undefined ? {} : { timer: options.timer }),
  });
  const interpreters: SessionInterpreterComposition['interpreters'] = [
    createEventAppendInterpreter({
      secrets: (correlation) =>
        resources.preparations.forSession(correlation)?.opening.environment?.secrets ?? [],
      clock: options.clock,
      sink: options.eventSink,
      ...(options.timer === undefined ? {} : { timer: options.timer }),
    }),
    ...createProviderOpeningInterpreters({
      ...shared,
      driver: options.driver,
      identities: options.identities,
      preparer: options.preparer,
      spawner: options.spawner,
    }),
    createProviderTurnInterpreter({ ...shared, digest: options.digest }),
    createProviderInteractionInterpreter(shared),
    ...createProviderLifecycleInterpreters(shared),
    persistence.save,
    persistence.remove,
    createCheckpointCaptureInterpreter({ ...shared, digest: options.digest }),
    createProcessCleanupInterpreter(shared),
    createOutputPublicationInterpreter(shared),
  ];
  return Object.freeze({ interpreters: Object.freeze(interpreters), resources });
};
