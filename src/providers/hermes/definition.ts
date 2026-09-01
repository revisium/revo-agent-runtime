import type { SystemExecutableProbe } from '../../discovery/platform.js';
import { acpDefinition } from '../acp-definition.js';
import type { SystemAcpProviderPolicy } from '../system-acp-detector.js';

const hermesVersionProbe: SystemExecutableProbe = Object.freeze({
  args: ['acp', '--version'],
  timeoutMs: 3_000,
});

const hermesAcpDefinition = (command: string) =>
  acpDefinition({
    args: ['acp'],
    command,
    displayName: 'Hermes ACP',
    id: 'hermes-acp',
    version: '1.0.0',
    versionProbeArgs: hermesVersionProbe.args,
    versionProbeTimeoutMs: hermesVersionProbe.timeoutMs,
  });

export const hermesProviderPolicy: SystemAcpProviderPolicy = Object.freeze({
  command: 'hermes',
  definition: hermesAcpDefinition,
  detectorId: 'hermes',
  unavailableMessage: 'Hermes ACP system executable is unavailable.',
  versionProbe: hermesVersionProbe,
});
