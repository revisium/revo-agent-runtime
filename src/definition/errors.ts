import type { AgentDefinition, AgentRef } from '../contracts/agent-definition.js';

export interface ValidatedAgentDefinition {
  readonly definition: AgentDefinition;
  readonly digest: string;
  canonicalBytes(): Uint8Array;
}

export class DefinitionValidationError extends Error {
  constructor(readonly code: 'definition_invalid' | 'strategy_unsupported') {
    super(
      code === 'definition_invalid'
        ? 'Agent definition is invalid.'
        : 'Agent strategy is unsupported.',
    );
    this.name = 'DefinitionValidationError';
  }
}

export class DuplicateAgentDefinitionError extends Error {
  readonly agent: AgentRef;

  constructor(
    agent: AgentRef,
    readonly firstIndex: number,
    readonly duplicateIndex: number,
  ) {
    super(`Agent definition ${agent.id}@${agent.version} is duplicated.`);
    this.name = 'DuplicateAgentDefinitionError';
    this.agent = Object.freeze({ ...agent });
  }
}
