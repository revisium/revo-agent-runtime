import { PROCESS_START_INVOCATION_TOKENS } from './process-start-invocation-tokens.js';

export const getProcessStartInvocationToken = (attempt: unknown): object | undefined => {
  if (typeof attempt !== 'object' || attempt === null) return undefined;
  return PROCESS_START_INVOCATION_TOKENS.get(attempt);
};
