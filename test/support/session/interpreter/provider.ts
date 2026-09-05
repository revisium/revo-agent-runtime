import { validateAgentDefinition } from '../../../../src/definition/index.js';
import type { SessionOutputPublicationTarget } from '../../../../src/execution/output/session/publication.js';
import { SessionOutputCollector } from '../../../../src/execution/session/interpreter/output/collect.js';
import {
  type PreparedSessionResource,
  type SessionInterpreterResources,
} from '../../../../src/execution/session/interpreter/provider/opening/resources.js';
import { SessionUsageAccumulator } from '../../../../src/execution/session/interpreter/provider/usage.js';
import type { SessionProtocolCapabilities } from '../../../../src/protocol/session/model/outcome.js';
import type { SessionProtocolSession } from '../../../../src/protocol/session/port/session.js';
import { agentDefinition } from '../../builders/agent-definition.js';
import { sessionOpeningCommand } from '../builders/kernel/opening.js';

const fullSessionProtocolCapabilities: SessionProtocolCapabilities = {
  cancellation: { prompt: true, session: true },
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
};

export const registerProtocolSession = (
  resources: SessionInterpreterResources,
  session: SessionProtocolSession,
  options: {
    readonly capabilities?: SessionProtocolCapabilities;
    readonly providerResourceId?: string;
    readonly secrets?: Readonly<Record<string, string>>;
    readonly output?: SessionOutputPublicationTarget;
  } = {},
): PreparedSessionResource => {
  const definition = validateAgentDefinition(agentDefinition({ version: '1' })).definition;
  const descriptor = {
    ...sessionOpeningCommand().opening,
    environment: { inherit: [], secrets: options.secrets ?? {}, variables: {} },
  };
  const preparation: PreparedSessionResource = {
    correlation: { effectId: 'prepare', epoch: 1, sessionId: 'session_01' },
    opening: descriptor,
    output: new SessionOutputCollector(
      descriptor.limits.maxOutputBytes,
      Object.values(options.secrets ?? {}),
    ),
    prepared: {
      definition,
      launch: { args: [], command: 'agent', cwd: '/workspace' },
      output: options.output ?? {
        publish: async () => ({
          files: {
            directory: '/output',
            manifest: 'session.json',
            stderr: 'stderr.log',
            stdout: 'stdout.log',
          },
          state: 'published',
        }),
      },
    },
  };
  resources.preparations.register('preparation-1', preparation);
  resources.providers.register(options.providerResourceId ?? 'provider-1', {
    capabilities: options.capabilities ?? fullSessionProtocolCapabilities,
    preparation,
    session,
    usage: new SessionUsageAccumulator(descriptor.usageBaseline),
  });
  return preparation;
};
