import { acpDefinition } from '../acp-definition.js';
import type { NodeAcpProviderPolicy } from '../node-acp-detector.js';

const copilotVersionProbeTimeoutMs = 5_000;

const copilotAcpDefinition = (entrypoint: string) =>
  acpDefinition({
    args: [entrypoint, '--acp', '--stdio'],
    command: process.execPath,
    displayName: 'GitHub Copilot ACP',
    id: 'copilot-acp',
    version: '1.0.0',
    versionProbeArgs: [entrypoint, '--version'],
    versionProbePrefix: 'GitHub Copilot CLI ',
    versionProbeTimeoutMs: copilotVersionProbeTimeoutMs,
  });

export const copilotProviderPolicy: NodeAcpProviderPolicy = Object.freeze({
  definition: copilotAcpDefinition,
  detectorId: 'copilot',
  nodePackage: Object.freeze({
    binName: 'copilot',
    command: 'copilot',
    packageName: '@github/copilot',
  }),
  unavailableMessage: 'GitHub Copilot ACP system package is unavailable.',
});
