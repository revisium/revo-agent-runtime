import { defaultSystemExecutableProbe } from '../../discovery/platform.js';
import { acpDefinition } from '../acp-definition.js';
import type { SystemAcpProviderPolicy } from '../system-acp-detector.js';

const grokAcpDefinition = (command: string) => {
  const definition = acpDefinition({
    args: ['agent', 'stdio'],
    command,
    displayName: 'Grok ACP',
    id: 'grok-acp',
    version: '1.0.1',
    versionProbePrefix: 'grok ',
  });
  return {
    ...definition,
    permissions: {
      schema: {
        ...definition.permissions.schema,
        properties: {
          mcpTools: {
            type: 'array',
            maxItems: 64,
            uniqueItems: true,
            items: {
              type: 'string',
              minLength: 3,
              maxLength: 256,
            },
          },
        },
      },
    },
  };
};

export const grokProviderPolicy: SystemAcpProviderPolicy = Object.freeze({
  command: 'grok',
  definition: grokAcpDefinition,
  detectorId: 'grok',
  unavailableMessage: 'Grok ACP system executable is unavailable.',
  versionProbe: defaultSystemExecutableProbe,
});
