import type { AgentDefinitionContract } from '../../spec/index.js';

export interface ValidatedDefinition {
  readonly definition: AgentDefinitionContract;
  readonly definitionDigest: string;
}
