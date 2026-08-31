import type { AgentDefinition } from '../../contracts/agent-definition.js';

export const literalArguments = (definition: AgentDefinition): readonly string[] | undefined => {
  const args: string[] = [];
  for (const argument of definition.launch.args) {
    if (argument.kind !== 'literal') return undefined;
    args.push(argument.value);
  }
  return args;
};
