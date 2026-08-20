import { AGENT_RUNTIME_LIMITS } from '../policy/index.js';
import type { JsonObject } from '../spec/index.js';
import { canonicalJsonRecord } from './canonical-json-record.js';

export const canonicalEffectiveInputs = Object.freeze({
  parameters: (source: unknown): JsonObject | undefined =>
    canonicalJsonRecord.copy(source, AGENT_RUNTIME_LIMITS.parameterBytes),
  permissions: (source: unknown): JsonObject | undefined =>
    canonicalJsonRecord.copy(source, AGENT_RUNTIME_LIMITS.permissionBytes),
});
