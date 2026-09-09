export const withNativeResource = <T>(action: () => T, release: () => void): T => {
  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: action() };
  } catch (error) {
    outcome = { error };
  }
  try {
    release();
  } catch (error) {
    if ('error' in outcome)
      throw new AggregateError([outcome.error, error], 'Native operation and cleanup failed.', {
        cause: error,
      });
    throw error;
  }
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
};

export const nodeErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
