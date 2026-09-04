import type { JsonObject } from '../../../../contracts/agent-definition.js';
import { AgentManagerError } from '../../../../contracts/manager.js';
import { isJsonObject } from '../../../../definition/canonical-json.js';
import { decodeImmutableJsonObject, hasExactJsonKeys } from './immutable-json.js';
import {
  decodeAgentSessionLaunchInput,
  type DecodedAgentSessionLaunchInput,
  invalidSessionRequest,
  sessionRequestJsonLimits,
} from './launch.js';

export interface DecodedResumeAgentSession extends DecodedAgentSessionLaunchInput {
  readonly token: Readonly<JsonObject>;
}

export const decodeResumeAgentSession = (input: unknown): DecodedResumeAgentSession => {
  try {
    const value = decodeImmutableJsonObject(input, sessionRequestJsonLimits);
    if (
      !hasExactJsonKeys(
        value,
        ['output', 'parameters', 'permissions', 'token', 'workspace'],
        ['configuration', 'limits', 'metadata'],
      ) ||
      !isJsonObject(value.token)
    )
      return invalidSessionRequest();
    return Object.freeze({ ...decodeAgentSessionLaunchInput(value), token: value.token });
  } catch (error: unknown) {
    if (error instanceof AgentManagerError) throw error;
    return invalidSessionRequest();
  }
};
