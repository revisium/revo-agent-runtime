export class EffectTracker {
  readonly #active = new Set<string>();
  readonly #idleWaiters = new Set<() => void>();

  get size(): number {
    return this.#active.size;
  }

  begin(effectId: string): boolean {
    if (this.#active.has(effectId)) return false;
    this.#active.add(effectId);
    return true;
  }

  finish(effectId: string): boolean {
    if (!this.#active.delete(effectId)) return false;
    if (this.#active.size === 0) {
      for (const resolve of this.#idleWaiters) resolve();
      this.#idleWaiters.clear();
    }
    return true;
  }

  whenIdle(): Promise<void> {
    if (this.#active.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.add(resolve));
  }
}
