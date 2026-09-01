import { acpDefinition } from '../acp-definition.js';
import type { NodeAcpProviderPolicy } from '../node-acp-detector.js';

const qwenAcpDefinition = (entrypoint: string) =>
  acpDefinition({
    args: [entrypoint, '--acp'],
    command: process.execPath,
    displayName: 'Qwen Code ACP',
    id: 'qwen-acp',
    version: '1.0.0',
    versionProbeArgs: [entrypoint, '--version'],
  });

export const qwenProviderPolicy: NodeAcpProviderPolicy = Object.freeze({
  definition: qwenAcpDefinition,
  detectorId: 'qwen',
  nodePackage: Object.freeze({
    binName: 'qwen',
    command: 'qwen',
    packageName: '@qwen-code/qwen-code',
  }),
  unavailableMessage: 'Qwen Code ACP system package is unavailable.',
});
