import type { InvocationClockPort } from '../../runtime/execution/index.js';

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

export class NodeMonotonicInvocationClock implements InvocationClockPort {
  readonly #origin = process.hrtime.bigint();

  now(): number {
    return Number((process.hrtime.bigint() - this.#origin) / NANOSECONDS_PER_MILLISECOND);
  }

  schedule(delayMs: number, callback: () => void): () => void {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return () => {
      clearTimeout(timer);
    };
  }
}
