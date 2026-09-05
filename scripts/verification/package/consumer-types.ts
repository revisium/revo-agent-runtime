export const packedConsumerTypes = (packageName: string): string => `
import type {
  AgentConfigurationCatalog,
  AgentConfigurationSelection,
  AgentDefinitionInput,
  AgentDiscoveryResult,
  AgentManagerInitialization,
  AgentSession,
  AgentSessions,
  InspectAgentConfiguration,
  OpenAgentSession,
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

const sessionRequest: OpenAgentSession = {
  agent: { id: 'agent', version: '1' },
  output: { directory: '/output/session' },
  parameters: {},
  permissions: {},
  sessionId: 'dlg_consumer',
  workspace: { directory: '/workspace' },
};
declare const sessions: AgentSessions;
declare const session: AgentSession;
void sessions.open(sessionRequest);
void session.send({ prompt: 'Continue.', turnId: 'trn_consumer' });
const initialization: AgentManagerInitialization = { invocations: [], sessions: [] };
void initialization;
`;
