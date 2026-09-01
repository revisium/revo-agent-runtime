import { acpDefinition } from '../acp-definition.js';
import type { NodeAcpProviderPolicy } from '../node-acp-detector.js';

const kiloVersionProbeTimeoutMs = 5_000;

const kiloAcpDefinition = (entrypoint: string) =>
  acpDefinition({
    args: [entrypoint, 'acp'],
    command: process.execPath,
    displayName: 'Kilo Code ACP',
    id: 'kilo-acp',
    version: '1.0.0',
    versionProbeArgs: [entrypoint, '--version'],
    versionProbeTimeoutMs: kiloVersionProbeTimeoutMs,
  });

export const kiloProviderPolicy: NodeAcpProviderPolicy = Object.freeze({
  definition: kiloAcpDefinition,
  detectorId: 'kilo',
  nodePackage: Object.freeze({
    binName: 'kilo',
    command: 'kilo',
    packageName: '@kilocode/cli',
  }),
  unavailableMessage: 'Kilo Code ACP system package is unavailable.',
});
