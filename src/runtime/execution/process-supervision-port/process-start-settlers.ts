export const PROCESS_START_SETTLERS = new WeakMap<
  object,
  (
    outcome: Readonly<{ status: 'accepted'; spawnedAt: number }> | Readonly<{ status: 'failed' }>,
  ) => void
>();
