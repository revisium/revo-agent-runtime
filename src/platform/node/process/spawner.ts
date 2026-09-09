import type { ProcessLauncher, ProcessSpawner } from '../../../execution/process/port.js';
import type { ProcessIdentityInspector } from './identity.js';
import { processPlatform } from './platform.js';

export const createNodeProcessSpawner = (
  inspectIdentity?: ProcessIdentityInspector,
): ProcessSpawner => ({
  async start(launch, signal) {
    return (await processPlatform()).spawn(launch, signal, inspectIdentity);
  },
});
export const nodeProcessSpawner: ProcessSpawner = createNodeProcessSpawner();
export const nodeProcessLauncher: ProcessLauncher = {
  async start(launch, signal) {
    return (await processPlatform()).launch(launch, signal);
  },
};
