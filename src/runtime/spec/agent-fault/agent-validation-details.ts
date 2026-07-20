import type { JsonObject } from '../json/index.js';
import type { AgentValidationDiagnostic } from './agent-validation-diagnostic.js';

export interface AgentValidationDetails extends JsonObject {
  readonly diagnostics: readonly AgentValidationDiagnostic[];
  readonly truncated: boolean;
}
