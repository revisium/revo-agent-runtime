export type ConfigurationDeadlineOutcome = 'cancelled' | 'timed_out';

export class ConfigurationDeadline {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly resolved = Promise.withResolvers<ConfigurationDeadlineOutcome>();
  private readonly wallTimer: ReturnType<typeof setTimeout>;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private outcome: ConfigurationDeadlineOutcome | undefined;
  private readonly onExternalAbort = (): void => this.commit('cancelled');

  constructor(
    external: AbortSignal,
    wallClockTimeoutMs: number,
    private readonly idleTimeoutMs: number,
  ) {
    this.signal = this.controller.signal;
    external.addEventListener('abort', this.onExternalAbort, { once: true });
    this.wallTimer = setTimeout(() => this.commit('timed_out'), wallClockTimeoutMs);
    if (external.aborted) this.commit('cancelled');
  }

  activity = (): void => {
    if (this.outcome !== undefined) return;
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.commit('timed_out'), this.idleTimeoutMs);
  };

  completion(): Promise<ConfigurationDeadlineOutcome> {
    return this.resolved.promise;
  }

  current(): ConfigurationDeadlineOutcome | undefined {
    return this.outcome;
  }

  finish(external: AbortSignal): void {
    clearTimeout(this.wallTimer);
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    external.removeEventListener('abort', this.onExternalAbort);
  }

  private commit(outcome: ConfigurationDeadlineOutcome): void {
    if (this.outcome !== undefined) return;
    this.outcome = outcome;
    this.controller.abort();
    this.resolved.resolve(outcome);
  }
}
