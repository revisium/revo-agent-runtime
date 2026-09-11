import * as acp from '@agentclientprotocol/sdk';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Chooses an explicit nested ACP reason, then the protocol error message, or a safe fallback. */
export const acpFailureMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof acp.RequestError)) return fallback;
  if (isRecord(error.data)) {
    const nested = isRecord(error.data.error) ? error.data.error : undefined;
    for (const candidate of [nested?.message, nested?.reason])
      if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return error.message.trim().length > 0 ? error.message : fallback;
};
