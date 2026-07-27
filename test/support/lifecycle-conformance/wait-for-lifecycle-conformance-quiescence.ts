const lifecycleConformanceQuiescenceMicrotaskTurns = 6;

export const waitForLifecycleConformanceQuiescence = (): Promise<void> => {
  let quiescence = Promise.resolve();

  for (
    let microtaskTurn = 0;
    microtaskTurn < lifecycleConformanceQuiescenceMicrotaskTurns;
    microtaskTurn += 1
  ) {
    quiescence = quiescence.then(() => undefined);
  }

  return quiescence;
};
