import { acpDefinition } from '../acp-definition.js';
import type { NodeAcpProviderPolicy } from '../node-acp-detector.js';

const kimiVersionProbeTimeoutMs = 5_000;

const kimiAcpDefinition = (entrypoint: string) =>
  acpDefinition({
    args: [entrypoint, 'acp'],
    command: process.execPath,
    displayName: 'Kimi Code ACP',
    id: 'kimi-acp',
    version: '1.0.0',
    versionProbeArgs: [entrypoint, '--version'],
    versionProbeTimeoutMs: kimiVersionProbeTimeoutMs,
  });

export const kimiProviderPolicy: NodeAcpProviderPolicy = Object.freeze({
  definition: kimiAcpDefinition,
  detectorId: 'kimi',
  nodePackage: Object.freeze({
    binName: 'kimi',
    command: 'kimi',
    packageName: '@moonshot-ai/kimi-code',
  }),
  unavailableMessage: 'Kimi Code ACP system package is unavailable.',
});
