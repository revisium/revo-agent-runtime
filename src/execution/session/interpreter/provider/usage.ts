import type { AgentUsage } from '../../../../contracts/manager/invocation.js';
import type { AgentSessionUsage } from '../../../../contracts/session/lifecycle/result.js';

const cumulative = (baseline: number | undefined, current: number | undefined) =>
  baseline === undefined && current === undefined ? undefined : (baseline ?? 0) + (current ?? 0);

const maximum = (previous: number | undefined, current: number | undefined) =>
  previous === undefined && current === undefined
    ? undefined
    : Math.max(previous ?? 0, current ?? 0);

/** Restores the pre-resume baseline while rejecting provider counter regressions. */
export class SessionUsageAccumulator {
  readonly #baseline: AgentSessionUsage;
  #current: AgentUsage = {};

  constructor(baseline: AgentSessionUsage) {
    this.#baseline = baseline;
  }

  observe(usage: AgentUsage): AgentSessionUsage {
    const currentInput = maximum(this.#current.inputTokens, usage.inputTokens);
    const currentOutput = maximum(this.#current.outputTokens, usage.outputTokens);
    const currentTotal = maximum(this.#current.totalTokens, usage.totalTokens);
    this.#current = {
      ...(currentInput === undefined ? {} : { inputTokens: currentInput }),
      ...(currentOutput === undefined ? {} : { outputTokens: currentOutput }),
      ...(currentTotal === undefined ? {} : { totalTokens: currentTotal }),
    };
    const inputTokens = cumulative(this.#baseline.inputTokens, this.#current.inputTokens);
    const outputTokens = cumulative(this.#baseline.outputTokens, this.#current.outputTokens);
    const totalTokens = cumulative(this.#baseline.totalTokens, this.#current.totalTokens);
    return Object.freeze({
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      scope: 'session_cumulative',
      ...(totalTokens === undefined ? {} : { totalTokens }),
    });
  }
}
