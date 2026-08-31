import { defaultSystemExecutableProbe } from '../../discovery/platform.js';
import { acpDefinition } from '../acp-definition.js';
import type { SystemAcpProviderPolicy } from '../system-acp-detector.js';

const geminiAcpDefinition = (command: string) =>
  acpDefinition({
    args: ['--acp'],
    command,
    displayName: 'Gemini ACP',
    id: 'gemini-acp',
    version: '1.0.0',
  });

export const geminiProviderPolicy: SystemAcpProviderPolicy = Object.freeze({
  command: 'gemini',
  definition: geminiAcpDefinition,
  detectorId: 'gemini',
  unavailableMessage: 'Gemini ACP system executable is unavailable.',
  versionProbe: defaultSystemExecutableProbe,
});
