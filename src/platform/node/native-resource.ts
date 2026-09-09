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
