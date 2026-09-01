import type { SystemExecutableProbe } from '../../discovery/platform.js';
import { acpDefinition } from '../acp-definition.js';
import type { SystemAcpProviderPolicy } from '../system-acp-detector.js';

const antigravityVersionProbe: SystemExecutableProbe = Object.freeze({
  args: ['--version'],
  timeoutMs: 20_000,
});

const antigravityAcpDefinition = (command: string) =>
  acpDefinition({
    args: ['--uid='],
    command,
    displayName: 'Google Antigravity ACP',
    id: 'antigravity-acp',
    version: '1.0.0',
    versionProbeArgs: antigravityVersionProbe.args,
    versionProbePrefix: 'Build label: ',
    versionProbeTimeoutMs: antigravityVersionProbe.timeoutMs,
  });

export const antigravityProviderPolicy: SystemAcpProviderPolicy = Object.freeze({
  command: 'agy_acp_server.par',
  definition: antigravityAcpDefinition,
  detectorId: 'antigravity',
  unavailableMessage: 'Google Antigravity ACP system executable is unavailable.',
  versionProbe: antigravityVersionProbe,
});
