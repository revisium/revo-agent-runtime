import { OUTPUT_PREPARATION_INVOCATION_TOKENS } from './output-preparation-invocation-tokens.js';

export const getOutputPreparationInvocationToken = (attempt: unknown): object | undefined => {
  if (typeof attempt !== 'object' || attempt === null) return undefined;
  return OUTPUT_PREPARATION_INVOCATION_TOKENS.get(attempt);
};
