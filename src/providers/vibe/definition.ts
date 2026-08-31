import type { SystemExecutableProbe } from '../../discovery/platform.js';
import { acpDefinition } from '../acp-definition.js';
import type { SystemAcpProviderPolicy } from '../system-acp-detector.js';

const vibeVersionProbe: SystemExecutableProbe = Object.freeze({
  args: ['--version'],
  timeoutMs: 5_000,
});

const vibeAcpDefinition = (command: string) =>
  acpDefinition({
    args: [],
    command,
    displayName: 'Mistral Vibe ACP',
    id: 'vibe-acp',
    version: '1.0.0',
    versionProbeTimeoutMs: vibeVersionProbe.timeoutMs,
  });

export const vibeProviderPolicy: SystemAcpProviderPolicy = Object.freeze({
  command: 'vibe-acp',
  definition: vibeAcpDefinition,
  detectorId: 'vibe',
  unavailableMessage: 'Mistral Vibe ACP system executable is unavailable.',
  versionProbe: vibeVersionProbe,
});
