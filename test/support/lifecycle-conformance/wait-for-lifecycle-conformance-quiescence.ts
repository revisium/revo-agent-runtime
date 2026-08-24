export const waitForLifecycleConformanceQuiescence = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));
