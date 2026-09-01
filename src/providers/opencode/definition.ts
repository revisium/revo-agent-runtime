import { acpDefinition } from '../acp-definition.js';
import type { SystemAcpProviderPolicy } from '../system-acp-detector.js';

const openCodeAcpDefinition = (command: string) =>
  acpDefinition({
    args: ['acp'],
    command,
    displayName: 'OpenCode ACP',
    id: 'opencode-acp',
    version: '1.0.0',
    versionProbeTimeoutMs: 3_000,
  });

export const openCodeProviderPolicy: SystemAcpProviderPolicy = Object.freeze({
  command: 'opencode',
  definition: openCodeAcpDefinition,
  detectorId: 'opencode',
  unavailableMessage: 'OpenCode ACP system executable is unavailable.',
  versionProbe: Object.freeze({ args: ['--version'], timeoutMs: 3_000 }),
});
