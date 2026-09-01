import { defaultSystemExecutableProbe } from '../../discovery/platform.js';
import { acpDefinition } from '../acp-definition.js';
import type { SystemAcpProviderPolicy } from '../system-acp-detector.js';

const grokAcpDefinition = (command: string) =>
  acpDefinition({
    args: ['agent', 'stdio'],
    command,
    displayName: 'Grok ACP',
    id: 'grok-acp',
    version: '1.0.0',
    versionProbePrefix: 'grok ',
  });

export const grokProviderPolicy: SystemAcpProviderPolicy = Object.freeze({
  command: 'grok',
  definition: grokAcpDefinition,
  detectorId: 'grok',
  unavailableMessage: 'Grok ACP system executable is unavailable.',
  versionProbe: defaultSystemExecutableProbe,
});
