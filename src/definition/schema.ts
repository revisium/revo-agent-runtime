import { z } from 'zod/v4';

import type { AgentDefinitionInput, JsonObject } from '../contracts/agent-definition.js';
import { isJsonObject } from './canonical-json.js';

const textEncoder = new TextEncoder();

const runtimeLimits = Object.freeze({
  agentIdentityBytes: 256,
  argumentBytes: 262_144,
  argumentCount: 4_096,
  argvBytes: 1_048_576,
  definitionBytes: 1_048_576,
  descriptionBytes: 4_096,
  displayNameBytes: 256,
  versionProbePrefixBytes: 1_024,
});

const boundedString = (minimum: number, maximum: number) =>
  z.string().refine(
    (value) => {
      const length = textEncoder.encode(value).byteLength;
      return length >= minimum && length <= maximum;
    },
    { message: 'String exceeds its permitted UTF-8 byte bounds.' },
  );

const boundedArgumentString = boundedString(0, runtimeLimits.argumentBytes);
const boundedStrategyIdentifier = boundedString(1, runtimeLimits.agentIdentityBytes);

const versionProbeSchema = z.strictObject({
  args: z.array(boundedArgumentString).min(1).max(runtimeLimits.argumentCount),
  stream: z.enum(['stdout', 'stderr']),
  prefix: boundedString(1, runtimeLimits.versionProbePrefixBytes).exactOptional(),
  timeoutMs: z.number().int().min(1_000).max(30_000),
});

const argumentTemplateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('literal'), value: boundedArgumentString }),
  z.strictObject({ kind: z.literal('workspace') }),
  z.strictObject({ kind: z.literal('prompt') }),
  z.strictObject({ kind: z.literal('prompt-file') }),
  z.strictObject({ kind: z.literal('result-schema') }),
  z.strictObject({ kind: z.literal('result-schema-file') }),
  z.strictObject({
    kind: z.literal('parameter'),
    name: boundedArgumentString,
    omitIfMissing: z.boolean().exactOptional(),
  }),
  z.strictObject({
    kind: z.literal('permission'),
    name: boundedArgumentString,
    omitIfMissing: z.boolean().exactOptional(),
  }),
]);

const sessionCapabilitySchema = z.strictObject({
  multiTurn: z.literal(true),
  resume: z.enum(['none', 'native']),
  interactions: z.strictObject({
    permission: z.boolean(),
    input: z.boolean(),
  }),
  updates: z.strictObject({
    message: z.literal(true),
    progress: z.boolean(),
    tool: z.boolean(),
    plan: z.boolean(),
    usage: z.boolean(),
  }),
});

const agentDefinitionSchema = z.strictObject({
  schemaVersion: z.literal('agent-definition/v1'),
  id: boundedString(1, runtimeLimits.agentIdentityBytes),
  version: boundedString(1, runtimeLimits.agentIdentityBytes),
  displayName: boundedString(1, runtimeLimits.displayNameBytes),
  description: boundedString(0, runtimeLimits.descriptionBytes).exactOptional(),
  launch: z.strictObject({
    command: boundedString(1, runtimeLimits.argumentBytes),
    args: z.array(argumentTemplateSchema).max(runtimeLimits.argumentCount),
    versionProbe: versionProbeSchema,
  }),
  protocol: z.strictObject({
    driver: boundedStrategyIdentifier,
    resultParser: boundedStrategyIdentifier.exactOptional(),
    permissionStrategy: boundedStrategyIdentifier,
  }),
  delivery: z.strictObject({
    prompt: z.enum(['argument', 'stdin', 'file', 'protocol']),
    resultSchema: z.enum(['argument', 'file', 'protocol']),
    result: z.enum(['stdout', 'protocol']),
  }),
  parameters: z.strictObject({
    schema: z.custom<JsonObject>(isJsonObject),
    defaults: z.custom<JsonObject>(isJsonObject).exactOptional(),
  }),
  permissions: z.strictObject({
    schema: z.custom<JsonObject>(isJsonObject),
    defaults: z.custom<JsonObject>(isJsonObject).exactOptional(),
  }),
  capabilities: z.strictObject({
    cancellation: z.boolean(),
    structuredResult: z.literal(true),
    usage: z.boolean(),
    session: sessionCapabilitySchema.exactOptional(),
  }),
  constraints: z
    .strictObject({
      platforms: z
        .array(z.enum(['darwin', 'linux', 'win32']))
        .max(3)
        .exactOptional(),
    })
    .exactOptional(),
});

export const definitionByteLimit = runtimeLimits.definitionBytes;
export const probeArgumentByteLimit = runtimeLimits.argvBytes;

export const parseAgentDefinitionShape = (value: unknown): AgentDefinitionInput | undefined => {
  const result = agentDefinitionSchema.safeParse(value);
  return result.success ? result.data : undefined;
};
