import type { NormalizedInvocationOutcome } from '../../runtime/execution/index.js';

export class CompletedInvocations {
  private readonly outcomes = new Map<string, NormalizedInvocationOutcome>();

  constructor(private readonly capacity: number) {}

  has(invocationId: string): boolean {
    return this.outcomes.has(invocationId);
  }

  get(invocationId: string): NormalizedInvocationOutcome | undefined {
    return this.outcomes.get(invocationId);
  }

  commit(invocationId: string, outcome: NormalizedInvocationOutcome): void {
    this.outcomes.set(invocationId, outcome);
    while (this.outcomes.size > this.capacity) {
      const oldestInvocationId = this.outcomes.keys().next().value;
      if (oldestInvocationId === undefined) return;
      this.outcomes.delete(oldestInvocationId);
    }
  }
}
