import type { AgentDefinition } from '../../contracts/agent-definition.js';

/** Definition-owned adapter bindings cannot be changed by a per-call context. */
export const launchEnvironment = (
  definition: AgentDefinition,
  environment: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> => {
  const bindings = definition.launch.environment ?? {};
  const boundNames = new Set(Object.keys(bindings).map((name) => name.toUpperCase()));
  return Object.freeze({
    ...Object.fromEntries(
      Object.entries(environment).filter(([name]) => !boundNames.has(name.toUpperCase())),
    ),
    ...bindings,
  });
};
