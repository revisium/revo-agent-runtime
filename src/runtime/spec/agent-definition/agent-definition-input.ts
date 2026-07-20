import type { AgentDefinitionContract } from './agent-definition-contract.js';

interface AgentProtocolInput {
  readonly driver: string;
  readonly resultParser?: string;
  readonly permissionStrategy: string;
}

export type AgentDefinitionInput = Omit<AgentDefinitionContract, 'protocol'> & {
  readonly protocol: AgentProtocolInput;
};
