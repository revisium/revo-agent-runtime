import { defaultSystemExecutableProbe } from '../../discovery/platform.js';
import { acpDefinition } from '../acp-definition.js';
import type { SystemAcpProviderPolicy } from '../system-acp-detector.js';

const gooseAcpDefinition = (command: string) =>
  acpDefinition({
    args: ['acp'],
    command,
    displayName: 'Goose ACP',
    id: 'goose-acp',
    version: '1.0.0',
    versionProbePrefix: ' ',
  });

export const gooseProviderPolicy: SystemAcpProviderPolicy = Object.freeze({
  command: 'goose',
  definition: gooseAcpDefinition,
  detectorId: 'goose',
  unavailableMessage: 'Goose ACP system executable is unavailable.',
  versionProbe: defaultSystemExecutableProbe,
});
