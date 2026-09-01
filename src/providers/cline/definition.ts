import type { SystemExecutableProbe } from '../../discovery/platform.js';
import { acpDefinition } from '../acp-definition.js';
import type { SystemAcpProviderPolicy } from '../system-acp-detector.js';

const clineVersionProbe: SystemExecutableProbe = Object.freeze({
  args: ['--version'],
  timeoutMs: 5_000,
});

const clineAcpDefinition = (command: string) =>
  acpDefinition({
    args: ['--acp'],
    command,
    displayName: 'Cline ACP',
    id: 'cline-acp',
    version: '1.0.0',
    versionProbeTimeoutMs: clineVersionProbe.timeoutMs,
  });

export const clineProviderPolicy: SystemAcpProviderPolicy = Object.freeze({
  command: 'cline',
  definition: clineAcpDefinition,
  detectorId: 'cline',
  unavailableMessage: 'Cline ACP system executable is unavailable.',
  versionProbe: clineVersionProbe,
});
