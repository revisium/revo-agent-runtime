import { AgentManagerError } from '../../../../contracts/manager/core.js';
import type { OpenAgentSession } from '../../../../contracts/session.js';
import { isJsonObject } from '../../../../definition/canonical-json.js';
import { decodeImmutableJsonObject, hasExactJsonKeys } from './immutable-json.js';
import {
  boundedSessionString,
  decodeAgentSessionLaunchInput,
  type DecodedAgentSessionLaunchInput,
  invalidSessionRequest,
  sessionRequestJsonLimits,
} from './launch.js';

export interface DecodedOpenAgentSession extends DecodedAgentSessionLaunchInput {
  readonly agent: OpenAgentSession['agent'];
  readonly sessionId: string;
}

export const decodeOpenAgentSession = (input: unknown): DecodedOpenAgentSession => {
  try {
    const value = decodeImmutableJsonObject(input, sessionRequestJsonLimits);
    if (
      !hasExactJsonKeys(
        value,
        ['agent', 'output', 'parameters', 'permissions', 'sessionId', 'workspace'],
        ['configuration', 'limits', 'metadata'],
      ) ||
      !isJsonObject(value.agent) ||
      !hasExactJsonKeys(value.agent, ['id', 'version'])
    )
      return invalidSessionRequest();
    const launch = decodeAgentSessionLaunchInput(value);
    return Object.freeze({
      ...launch,
      agent: Object.freeze({
        id: boundedSessionString(value.agent.id, 256),
        version: boundedSessionString(value.agent.version, 256),
      }),
      sessionId: boundedSessionString(value.sessionId, 256),
    });
  } catch (error: unknown) {
    if (error instanceof AgentManagerError) throw error;
    return invalidSessionRequest();
  }
};
