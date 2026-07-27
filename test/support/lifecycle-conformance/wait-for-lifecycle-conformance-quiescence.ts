// A controlled lifecycle action crosses at most six promise continuations before settlement.
export const waitForLifecycleConformanceQuiescence = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
