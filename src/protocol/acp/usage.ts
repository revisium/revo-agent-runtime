import type { AgentUsage } from '../../contracts/manager.js';

class AcpUsageInvalidError extends Error {
  constructor() {
    super('ACP usage is invalid.');
    this.name = 'AcpUsageInvalidError';
  }
}

const tokenCount = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new AcpUsageInvalidError();
  return Number(value);
};

export const normalizeAcpUsage = (value: unknown): AgentUsage => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('inputTokens' in value) ||
    !('outputTokens' in value) ||
    !('totalTokens' in value)
  )
    throw new AcpUsageInvalidError();
  return Object.freeze({
    inputTokens: tokenCount(value.inputTokens),
    outputTokens: tokenCount(value.outputTokens),
    totalTokens: tokenCount(value.totalTokens),
  });
};
