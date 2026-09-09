import { ProcessStartError, type ProcessCleanupOutcome } from '../contracts.js';

export const rejectProcessStart = async (
  cause: unknown,
  cleanup: () => Promise<ProcessCleanupOutcome>,
): Promise<never> => {
  let outcome: ProcessCleanupOutcome;
  try {
    outcome = await cleanup();
  } catch (error_) {
    throw new ProcessStartError('uncertain', {
      cause: new AggregateError([cause, error_], 'Process start and cleanup failed.', {
        cause,
      }),
    });
  }
  throw new ProcessStartError(outcome.status, { cause });
};
