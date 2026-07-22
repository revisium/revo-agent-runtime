import { z } from 'zod/v4';

import { AGENT_RUNTIME_LIMITS } from '../../policy/index.js';
import type { JsonObject, JsonSchema202012 } from '../../spec/index.js';

const encoder = new TextEncoder();

const boundedString = (minimum: number, maximum: number) =>
  z.string().refine(
    (value) => {
      const length = encoder.encode(value).byteLength;
      return length >= minimum && length <= maximum;
    },
    { message: 'String exceeds its permitted UTF-8 byte bounds.' },
  );

const boundedArgumentString = boundedString(0, AGENT_RUNTIME_LIMITS.argumentBytes);
const boundedStrategyIdentifier = boundedString(1, AGENT_RUNTIME_LIMITS.agentIdentityBytes);

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const versionProbeSchema = z.strictObject({
  args: z.array(boundedArgumentString).min(1).max(AGENT_RUNTIME_LIMITS.argumentCount),
  stream: z.enum(['stdout', 'stderr']),
  prefix: boundedString(1, AGENT_RUNTIME_LIMITS.versionProbePrefixBytes).exactOptional(),
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

const launchSchema = z.strictObject({
  command: boundedString(1, AGENT_RUNTIME_LIMITS.argumentBytes),
  args: z.array(argumentTemplateSchema).max(AGENT_RUNTIME_LIMITS.argumentCount),
  versionProbe: versionProbeSchema.exactOptional(),
});

const protocolSchema = z.strictObject({
  driver: boundedStrategyIdentifier,
  resultParser: boundedStrategyIdentifier.exactOptional(),
  permissionStrategy: boundedStrategyIdentifier,
});

const deliverySchema = z.strictObject({
  prompt: z.enum(['argument', 'stdin', 'file', 'protocol']),
  resultSchema: z.enum(['argument', 'file', 'protocol']),
  result: z.enum(['stdout', 'protocol']),
});

const schemaAndDefaultsSchema = z.strictObject({
  schema: z.custom<JsonSchema202012>(isJsonObject),
  defaults: z.custom<JsonObject>(isJsonObject).exactOptional(),
});

const capabilitiesSchema = z.strictObject({
  cancellation: z.boolean(),
  structuredResult: z.literal(true),
  usage: z.boolean(),
});

const constraintsSchema = z.strictObject({
  platforms: z
    .array(z.enum(['darwin', 'linux', 'win32']))
    .max(3)
    .exactOptional(),
  executableVersion: boundedArgumentString.exactOptional(),
});

export const rawAgentDefinitionSchema = z.strictObject({
  schemaVersion: z.literal('agent-definition/v1'),
  id: boundedString(1, AGENT_RUNTIME_LIMITS.agentIdentityBytes),
  version: boundedString(1, AGENT_RUNTIME_LIMITS.agentIdentityBytes),
  displayName: boundedString(1, AGENT_RUNTIME_LIMITS.displayNameBytes),
  description: boundedString(0, AGENT_RUNTIME_LIMITS.descriptionBytes).exactOptional(),
  launch: launchSchema,
  protocol: protocolSchema,
  delivery: deliverySchema,
  parameters: schemaAndDefaultsSchema,
  permissions: schemaAndDefaultsSchema,
  capabilities: capabilitiesSchema,
  constraints: constraintsSchema.exactOptional(),
});
