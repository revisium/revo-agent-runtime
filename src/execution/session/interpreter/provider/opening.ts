import type { SessionProtocolDriver } from '../../../../protocol/session/port/driver.js';
import type { ProcessSpawner } from '../../../process/port.js';
import type { SessionOpeningPreparer } from '../../port/opening-preparation.js';
import type { SessionRuntimeIdentitySource } from '../../runtime/primitives/identity.js';
import type { SessionEffectHandler } from '../shared/effect/handler.js';
import type { SessionObservationClock } from '../shared/observation/clock.js';
import type { SessionOperationTimer } from '../shared/operation/timer.js';
import { createProviderConnectInterpreter } from './opening/connect.js';
import { createOpeningPreparationInterpreter } from './opening/prepare.js';
import { createProcessStartInterpreter } from './opening/process.js';
import type { SessionInterpreterResources } from './opening/resources.js';

export const createProviderOpeningInterpreters = (options: {
  readonly clock: SessionObservationClock;
  readonly driver: SessionProtocolDriver;
  readonly identities: SessionRuntimeIdentitySource;
  readonly preparer: SessionOpeningPreparer;
  readonly resources: SessionInterpreterResources;
  readonly spawner: ProcessSpawner;
  readonly timer?: SessionOperationTimer;
}): readonly SessionEffectHandler<'opening.prepare' | 'process.start' | 'provider.open'>[] => [
  createOpeningPreparationInterpreter(options),
  createProcessStartInterpreter(options),
  createProviderConnectInterpreter(options),
];
