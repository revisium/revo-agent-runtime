import type {
  AgentDefinitionSessionCapabilities,
  JsonObject,
} from '../../../../contracts/agent-definition.js';
import { AgentManagerError } from '../../../../contracts/manager.js';
import type { AgentSessionCapabilities } from '../../../../contracts/session.js';
import {
  canonicalizeCopiedJsonBytes,
  inspectAndCopyPlainJson,
  isJsonObject,
} from '../../../../definition/canonical-json.js';

const unsupported = (): never => {
  throw new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.session_unsupported',
      message: 'Agent session capability is unsupported.',
      phase: 'session_opening',
      retryable: false,
    }),
  );
};

const exactKeys = (value: Readonly<JsonObject>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

const booleanObject = (
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, boolean>> => {
  if (!isJsonObject(value)) return unsupported();
  const object = value;
  if (!exactKeys(object, [...keys].sort()) || keys.some((key) => typeof object[key] !== 'boolean'))
    return unsupported();
  const result: Record<string, boolean> = {};
  for (const key of keys) result[key] = Boolean(object[key]);
  return Object.freeze(result);
};

const decode = (value: unknown): AgentSessionCapabilities => {
  let object: Readonly<JsonObject>;
  try {
    const inspection = inspectAndCopyPlainJson(value);
    if (
      !isJsonObject(inspection.copy) ||
      inspection.depth > 4 ||
      inspection.nodes > 32 ||
      canonicalizeCopiedJsonBytes(inspection.copy).byteLength > 4_096
    )
      return unsupported();
    object = inspection.copy;
  } catch {
    return unsupported();
  }
  if (!exactKeys(object, ['interactions', 'multiTurn', 'resume', 'updates'])) return unsupported();
  if (object.multiTurn !== true || (object.resume !== 'none' && object.resume !== 'native'))
    return unsupported();
  const interactions = booleanObject(object.interactions, ['input', 'permission']);
  const updates = booleanObject(object.updates, ['message', 'plan', 'progress', 'tool', 'usage']);
  if (updates.message !== true) return unsupported();
  return Object.freeze({
    interactions: Object.freeze({
      input: Boolean(interactions.input),
      permission: Boolean(interactions.permission),
    }),
    multiTurn: true,
    resume: object.resume,
    updates: Object.freeze({
      message: true,
      plan: Boolean(updates.plan),
      progress: Boolean(updates.progress),
      tool: Boolean(updates.tool),
      usage: Boolean(updates.usage),
    }),
  });
};

const invents = (
  declared: AgentDefinitionSessionCapabilities,
  negotiated: AgentSessionCapabilities,
): boolean =>
  (declared.resume === 'none' && negotiated.resume === 'native') ||
  (!declared.interactions.input && negotiated.interactions.input) ||
  (!declared.interactions.permission && negotiated.interactions.permission) ||
  (!declared.updates.plan && negotiated.updates.plan) ||
  (!declared.updates.progress && negotiated.updates.progress) ||
  (!declared.updates.tool && negotiated.updates.tool) ||
  (!declared.updates.usage && negotiated.updates.usage);

export const resolveSessionCapabilities = (
  declared: AgentDefinitionSessionCapabilities | undefined,
  negotiatedValue: unknown,
): AgentSessionCapabilities => {
  if (declared === undefined) return unsupported();
  const negotiated = decode(negotiatedValue);
  if (invents(declared, negotiated)) return unsupported();
  return negotiated;
};
