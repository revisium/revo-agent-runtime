import type { AgentManagerLimits } from '../../spec/index.js';
import type { ValidatedDefinition } from './validated-definition.js';

export interface ValidatedManagerConstruction {
  readonly definitions: readonly ValidatedDefinition[];
  readonly limits: Readonly<AgentManagerLimits>;
  readonly redaction: Readonly<{ readonly secrets: readonly string[] }>;
}
