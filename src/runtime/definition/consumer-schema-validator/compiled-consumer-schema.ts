import type { AgentValidationDetails, JsonValue } from '../../spec/index.js';

export interface CompiledConsumerSchema {
  validate(value: JsonValue, valueInstancePath: string): AgentValidationDetails | undefined;
}
