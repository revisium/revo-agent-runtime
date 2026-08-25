import type { AgentInvocationResult } from '../../runtime/spec/index.js';

export class CompletedInvocations {
  private readonly records = new Map<string, AgentInvocationResult>();

  constructor(private readonly capacity: number) {}

  has(invocationId: string): boolean {
    return this.records.has(invocationId);
  }

  get(invocationId: string): AgentInvocationResult | undefined {
    return this.records.get(invocationId);
  }

  values(): readonly AgentInvocationResult[] {
    return Object.freeze([...this.records.values()]);
  }

  commit(invocationId: string, record: AgentInvocationResult): void {
    this.records.set(invocationId, record);
    while (this.records.size > this.capacity) {
      const oldestInvocationId = this.records.keys().next().value;
      if (oldestInvocationId === undefined) return;
      this.records.delete(oldestInvocationId);
    }
  }
}
