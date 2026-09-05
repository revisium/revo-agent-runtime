export const flushMicrotasks = (remaining: number): Promise<void> => {
  if (remaining <= 0) return Promise.resolve();
  return Promise.resolve().then(() => flushMicrotasks(remaining - 1));
};

export const repeatAsync = (
  count: number,
  step: (index: number) => Promise<void> | void,
  index = 0,
): Promise<void> => {
  if (index >= count) return Promise.resolve();
  return Promise.resolve(step(index)).then(() => repeatAsync(count, step, index + 1));
};

export const repeatUntil = (
  limit: number,
  step: () => Promise<boolean> | boolean,
): Promise<void> => {
  if (limit <= 0) return Promise.resolve();
  return Promise.resolve(step()).then((done) => (done ? undefined : repeatUntil(limit - 1, step)));
};
