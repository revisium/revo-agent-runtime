import type { SessionOperationTimer } from './timer.js';

type ObservedSettlement<Value> =
  | { readonly state: 'fulfilled'; readonly value: Value }
  | { readonly state: 'rejected'; readonly error: unknown };

export type OperationSettlement<Value> =
  | (ObservedSettlement<Value> & { readonly phase: 'initial' | 'late' })
  | { readonly state: 'unknown' };

const observe = <Value>(operation: Promise<Value>): Promise<ObservedSettlement<Value>> =>
  operation.then(
    (value) => ({ state: 'fulfilled', value }),
    (error: unknown) => ({ error, state: 'rejected' }),
  );

const within = <Value>(
  operation: Promise<ObservedSettlement<Value>>,
  milliseconds: number,
  timer: SessionOperationTimer,
): Promise<ObservedSettlement<Value> | undefined> =>
  new Promise((resolve) => {
    let finished = false;
    const timeout = timer.schedule(milliseconds, () => {
      if (finished) return;
      finished = true;
      resolve(undefined);
    });
    void operation.then((settlement) => {
      if (finished) return;
      finished = true;
      timeout.cancel();
      resolve(settlement);
    });
  });

export const settleOperation = async <Value>(options: {
  readonly operation: Promise<Value>;
  readonly timeoutMs: number;
  readonly timer: SessionOperationTimer;
  readonly onTimeout: () => void;
}): Promise<OperationSettlement<Value>> => {
  const operation = observe(options.operation);
  const initial = await within(operation, options.timeoutMs, options.timer);
  if (initial !== undefined) return { ...initial, phase: 'initial' };
  options.onTimeout();
  const late = await within(operation, options.timeoutMs, options.timer);
  return late === undefined ? { state: 'unknown' } : { ...late, phase: 'late' };
};
