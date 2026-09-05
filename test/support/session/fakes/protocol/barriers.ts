interface BarrierState {
  readonly reached: PromiseWithResolvers<void>;
  readonly released: PromiseWithResolvers<void>;
}

export class FakeSessionProtocolBarriers {
  readonly #states = new Map<string, BarrierState>();

  reached(name: string): Promise<void> {
    return this.#state(name).reached.promise;
  }

  release(name: string): void {
    this.#state(name).released.resolve();
  }

  async wait(name: string): Promise<void> {
    const state = this.#state(name);
    state.reached.resolve();
    await state.released.promise;
  }

  #state(name: string): BarrierState {
    const existing = this.#states.get(name);
    if (existing !== undefined) return existing;
    const state = {
      reached: Promise.withResolvers<void>(),
      released: Promise.withResolvers<void>(),
    };
    this.#states.set(name, state);
    return state;
  }
}
