export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonSchema202012 = JsonObject;

export const M1_LIMITS = Object.freeze({
  definitionBytes: 1_048_576,
  schemaBytes: 1_048_576,
  definitions: 1_000,
  probeBatch: 1_000,
  schemaDepth: 64,
  schemaNodes: 8_192,
  resultNodes: 65_536,
  diagnosticCount: 16,
  diagnosticPathBytes: 1_024,
  diagnosticMessageBytes: 1_024,
  diagnosticKeywordBytes: 128,
  faultMessageBytes: 8_192,
  faultDetailsBytes: 65_536,
  probeStreamBytes: 65_536,
  versionProbePrefixBytes: 1_024,
  activeProbes: 8,
  argumentCount: 4_096,
  argumentBytes: 262_144,
  argvBytes: 1_048_576,
  agentIdentityBytes: 256,
  displayNameBytes: 256,
  descriptionBytes: 4_096,
  redactionValues: 1_000,
  redactionTotalBytes: 65_536,
} as const);
