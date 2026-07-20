import type { JsonObject } from '../json/index.js';

export interface AgentValidationDiagnostic extends JsonObject {
  readonly instancePath: string;
  readonly instancePathTruncated: boolean;
  readonly schemaPath: string;
  readonly schemaPathTruncated: boolean;
  readonly keyword: string;
  readonly message: string;
}

export interface AgentValidationDetails extends JsonObject {
  readonly diagnostics: readonly AgentValidationDiagnostic[];
  readonly truncated: boolean;
}
