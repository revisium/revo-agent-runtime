import type { AgentValidationDetails, JsonSchema202012 } from '../../spec/index.js';

export type ConsumerSchemaProfileValidation =
  | { readonly valid: true; readonly schema: JsonSchema202012 }
  | { readonly valid: false; readonly diagnostics: AgentValidationDetails };
