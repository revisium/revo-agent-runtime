import type { OwnedProcess, ProcessSpawner } from '../../../../src/execution/process/port.js';
import type { FakeSessionProtocolBarriers } from '../fakes/protocol/barriers.js';

export class StoryProcesses implements ProcessSpawner {
  #active = 0;
  #maximum = 0;
  #identity = 0;
  #completion: PromiseWithResolvers<{ exitCode: number; signal: null }> | undefined;

  constructor(
    private readonly barriers: FakeSessionProtocolBarriers,
    private readonly startBarrier?: string,
  ) {}

  get active(): number {
    return this.#active;
  }
  get maximum(): number {
    return this.#maximum;
  }

  exit(): void {
    if (this.#completion === undefined) throw new Error('No active fake process.');
    this.#completion.resolve({ exitCode: 1, signal: null });
  }

  async start(): Promise<OwnedProcess> {
    if (this.startBarrier !== undefined) await this.barriers.wait(this.startBarrier);
    const completion = Promise.withResolvers<{ exitCode: number; signal: null }>();
    this.#completion = completion;
    this.#active += 1;
    this.#maximum = Math.max(this.#maximum, this.#active);
    const identity = ++this.#identity;
    let cleaned = false;
    return {
      completion: completion.promise,
      identity: {
        fingerprint: `fake-process-${identity}`,
        pid: 42 + identity,
        processGroupId: 42 + identity,
        startedAt: '2026-09-05T00:00:00.000Z',
      },
      terminateAndReap: async () => {
        if (!cleaned) this.#active -= 1;
        cleaned = true;
        completion.resolve({ exitCode: 0, signal: null });
        return { exit: { exitCode: 0, signal: null }, status: 'confirmed' };
      },
      transport: {
        input: new WritableStream<Uint8Array>(),
        output: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
      },
    };
  }
}
