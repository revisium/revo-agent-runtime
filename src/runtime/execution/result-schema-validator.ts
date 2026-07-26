import type { AgentValidationDetails, JsonObject } from '../spec/index.js';

export interface ResultSchemaValidator {
  validate(value: JsonObject): AgentValidationDetails | undefined;
}
