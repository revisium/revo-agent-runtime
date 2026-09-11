import { decodeAgentConfigurationSelection } from '../../../../configuration/selection.js';
import type { JsonObject } from '../../../../contracts/agent-definition.js';
import type { AgentConfigurationSelection } from '../../../../contracts/configuration.js';
import { AgentManagerError } from '../../../../contracts/manager/core.js';
import type { AgentSessionLaunchInput } from '../../../../contracts/session.js';
import { isJsonObject } from '../../../../definition/canonical-json.js';
import { hasExactJsonKeys, immutableJsonByteLength } from './immutable-json.js';

export interface DecodedAgentSessionLaunchInput extends Omit<
  AgentSessionLaunchInput,
  'limits' | 'metadata' | 'parameters' | 'permissions'
> {
  readonly limits?: Readonly<JsonObject>;
  readonly metadata?: Readonly<JsonObject>;
  readonly parameters: Readonly<JsonObject>;
  readonly permissions: Readonly<JsonObject>;
}

const encoder = new TextEncoder();

export const sessionRequestJsonLimits = {
  maxBytes: 6_291_456,
  maxDepth: 32,
  maxNodes: 20_000,
} as const;

export const invalidSessionRequest = (): never => {
  throw new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.parameters_invalid',
      message: 'Agent session request is invalid.',
      phase: 'session_opening',
      retryable: false,
    }),
  );
};

export const boundedSessionString = (value: unknown, maximumBytes: number): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    encoder.encode(value).byteLength > maximumBytes
  )
    return invalidSessionRequest();
  return value;
};

const directory = (value: unknown): { readonly directory: string } => {
  if (!isJsonObject(value) || !hasExactJsonKeys(value, ['directory']))
    return invalidSessionRequest();
  return Object.freeze({ directory: boundedSessionString(value.directory, 16_384) });
};

const jsonObject = (value: unknown, maximumBytes: number): Readonly<JsonObject> => {
  if (!isJsonObject(value) || immutableJsonByteLength(value) > maximumBytes)
    return invalidSessionRequest();
  return value;
};

const configuration = (value: unknown): AgentConfigurationSelection | undefined => {
  if (value === undefined) return undefined;
  try {
    return decodeAgentConfigurationSelection(value);
  } catch {
    return invalidSessionRequest();
  }
};

export const decodeAgentSessionLaunchInput = (
  value: Readonly<JsonObject>,
): DecodedAgentSessionLaunchInput => {
  const selectedConfiguration = configuration(value.configuration);
  const metadata = value.metadata === undefined ? undefined : jsonObject(value.metadata, 262_144);
  return Object.freeze({
    ...(selectedConfiguration === undefined ? {} : { configuration: selectedConfiguration }),
    ...(value.limits === undefined ? {} : { limits: jsonObject(value.limits, 4_096) }),
    ...(metadata === undefined ? {} : { metadata }),
    output: directory(value.output),
    parameters: jsonObject(value.parameters, 262_144),
    permissions: jsonObject(value.permissions, 262_144),
    workspace: directory(value.workspace),
  });
};
