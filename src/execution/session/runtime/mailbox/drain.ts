import type { SessionMailboxQueue } from './queue.js';

export class SerializedMailboxDrain<Value> {
  #running = false;

  constructor(
    private readonly queue: SessionMailboxQueue<Value>,
    private readonly consume: (value: Value) => void,
  ) {}

  get running(): boolean {
    return this.#running;
  }

  run(): void {
    if (this.#running) return;
    this.#running = true;
    try {
      let entry = this.queue.take();
      while (entry !== undefined) {
        this.consume(entry.value);
        entry = this.queue.take();
      }
    } finally {
      this.#running = false;
    }
  }
}
