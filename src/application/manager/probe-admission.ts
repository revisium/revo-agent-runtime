import { AGENT_RUNTIME_LIMITS } from '../../runtime/policy/index.js';

type Operation<T> = () => Promise<T>;

export class ProbeAdmission {
  private active = 0;

  private readonly offers: Array<() => void> = [];

  runSingle<T>(operation: Operation<T>): Promise<T> {
    return this.offer(operation);
  }

  async runBatch<T>(operations: readonly Operation<T>[]): Promise<readonly T[]> {
    return Object.freeze(await this.runWaves(operations, 0, []));
  }

  private async runWaves<T>(
    operations: readonly Operation<T>[],
    offset: number,
    results: T[],
  ): Promise<T[]> {
    if (offset >= operations.length) return results;

    const wave = operations.slice(offset, offset + AGENT_RUNTIME_LIMITS.activeProbes);
    const settled = await Promise.allSettled(wave.map((operation) => this.offer(operation)));
    const rejected = settled.find((result) => result.status === 'rejected');

    if (rejected?.status === 'rejected') throw rejected.reason;

    for (const result of settled) {
      if (result.status === 'fulfilled') results.push(result.value);
    }

    return this.runWaves(operations, offset + AGENT_RUNTIME_LIMITS.activeProbes, results);
  }

  private offer<T>(operation: Operation<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.offers.push(() => {
        this.active += 1;
        void Promise.resolve()
          .then(operation)
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.drain();
          });
      });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < AGENT_RUNTIME_LIMITS.activeProbes) {
      const start = this.offers.shift();
      if (start === undefined) return;
      start();
    }
  }
}
