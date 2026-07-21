import type { AgentValidationDetails, JsonSchema202012 } from '../../spec/index.js';

export type P1SchemaValidation =
  | { readonly valid: true; readonly schema: JsonSchema202012 }
  | { readonly valid: false; readonly diagnostics: AgentValidationDetails };
