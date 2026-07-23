import type { AgentDefinitionContract } from '../../spec/index.js';

export interface ProbeTarget {
  readonly definition: AgentDefinitionContract;
  readonly definitionDigest: string;
}
