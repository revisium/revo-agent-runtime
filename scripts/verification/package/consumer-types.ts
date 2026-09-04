export const packedConsumerTypes = (packageName: string): string => `
import type {
  AgentConfigurationCatalog,
  AgentConfigurationSelection,
  AgentDefinitionInput,
  AgentDiscoveryResult,
  InspectAgentConfiguration,
} from '${packageName}';

const definition: AgentDefinitionInput = {
  schemaVersion: 'agent-definition/v1',
  id: 'agent',
  version: '1',
  displayName: 'Agent',
  launch: { command: 'agent', args: [], versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1000 } },
  protocol: { driver: 'acp/v1', permissionStrategy: 'acp/v1' },
  delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'protocol' },
  parameters: { schema: {} },
  permissions: { schema: {} },
  capabilities: { cancellation: true, structuredResult: true, usage: false },
};
void definition;
const discovery: AgentDiscoveryResult = { definitions: [], diagnostics: [], modelObservations: [] };
void discovery;
const inspection: InspectAgentConfiguration = {
  agent: { id: 'agent', version: '1' },
  workspace: { directory: '/workspace' },
};
void inspection;
const selection: AgentConfigurationSelection = { selections: { model: 'provider/model' } };
void selection;
declare const catalog: AgentConfigurationCatalog;
void catalog;

// @ts-expect-error Session declarations stay out of the shipped root until the facade works.
type PrematureAgentSession = import('${packageName}').AgentSession;
declare const prematureAgentSession: PrematureAgentSession;
void prematureAgentSession;
`;
