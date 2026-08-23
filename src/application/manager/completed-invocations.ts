import type { RetainedInvocationRecord } from './retained-invocation-record.js';

export class CompletedInvocations {
  private readonly records = new Map<string, RetainedInvocationRecord>();

  constructor(private readonly capacity: number) {}

  has(invocationId: string): boolean {
    return this.records.has(invocationId);
  }

  get(invocationId: string): RetainedInvocationRecord | undefined {
    return this.records.get(invocationId);
  }

  entries(): readonly (readonly [string, RetainedInvocationRecord])[] {
    return Object.freeze([...this.records.entries()].map((entry) => Object.freeze(entry)));
  }

  commit(invocationId: string, record: RetainedInvocationRecord): void {
    this.records.set(invocationId, record);
    while (this.records.size > this.capacity) {
      const oldestInvocationId = this.records.keys().next().value;
      if (oldestInvocationId === undefined) return;
      this.records.delete(oldestInvocationId);
    }
  }
}
