import { PROCESS_START_SETTLERS } from './process-start-settlers.js';

export const settleProcessStart = (
  attempt: object,
  outcome: Readonly<{ status: 'accepted'; spawnedAt: number }> | Readonly<{ status: 'failed' }>,
): void => {
  PROCESS_START_SETTLERS.get(attempt)?.(outcome);
};
