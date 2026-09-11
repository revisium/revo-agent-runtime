import { acpDefinition } from '../acp-definition.js';
import type { SystemAcpProviderPolicy } from '../system-acp-detector.js';

const openCodeAcpDefinition = (command: string) =>
  acpDefinition({
    // OpenCode's ACP command keeps protocol JSON on stdout. This environment
    // mirrors its log file to stderr, which the runtime already bounds/redacts.
    args: ['acp'],
    command,
    displayName: 'OpenCode ACP',
    id: 'opencode-acp',
    environment: { OPENCODE_PRINT_LOGS: '1' },
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
