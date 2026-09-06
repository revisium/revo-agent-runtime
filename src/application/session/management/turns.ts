import type {
  AgentSessionTurn,
  AgentSessionTurnResult,
  AgentSessionTurnSnapshot,
} from '../../../contracts/session.js';
import type { EffectiveAgentSessionManagerLimits } from '../policy/limits/resolve.js';

interface ManagedTurn {
  readonly handle: AgentSessionTurn;
  snapshot: AgentSessionTurnSnapshot;
}

const turnKey = (sessionId: string, turnId: string): string => JSON.stringify([sessionId, turnId]);
const encoder = new TextEncoder();

export class ManagedSessionTurns {
  readonly #turns = new Map<string, ManagedTurn>();
  readonly #completed = new Map<string, number>();
  #completedBytes = 0;

  constructor(
    private readonly limits: Pick<
      EffectiveAgentSessionManagerLimits,
      'maxCompletedTurns' | 'maxCompletedTurnBytes'
    >,
  ) {}

  add(handle: AgentSessionTurn): void {
    const { sessionId, turnId } = handle;
    const key = turnKey(sessionId, turnId);
    const entry: ManagedTurn = {
      handle,
      snapshot: Object.freeze({ sessionId, turnId, state: 'running' }),
    };
    this.#turns.set(key, entry);
    void handle.result().then(
      (result) => this.#complete(key, entry, result),
      () => this.#turns.delete(key),
    );
  }

  get(sessionId: string, turnId: string): AgentSessionTurn | undefined {
    return this.#turns.get(turnKey(sessionId, turnId))?.handle;
  }

  inspect(sessionId: string, turnId: string): AgentSessionTurnSnapshot | undefined {
    return this.#turns.get(turnKey(sessionId, turnId))?.snapshot;
  }

  #complete(key: string, entry: ManagedTurn, result: AgentSessionTurnResult): void {
    const { sessionId, turnId } = entry.handle;
    entry.snapshot = Object.freeze({ sessionId, turnId, state: 'completed', result });
    const bytes = encoder.encode(JSON.stringify(entry.snapshot)).byteLength;
    if (bytes > this.limits.maxCompletedTurnBytes) {
      this.#turns.delete(key);
      return;
    }
    this.#completed.set(key, bytes);
    this.#completedBytes += bytes;
    this.#evictCompleted();
  }

  #evictCompleted(): void {
    while (
      this.#completed.size > this.limits.maxCompletedTurns ||
      this.#completedBytes > this.limits.maxCompletedTurnBytes
    ) {
      const oldest = this.#completed.entries().next().value!;
      this.#completed.delete(oldest[0]);
      this.#turns.delete(oldest[0]);
      this.#completedBytes -= oldest[1];
    }
  }
}
