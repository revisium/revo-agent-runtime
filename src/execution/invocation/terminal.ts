import type { AgentFault, AgentUsage } from '../../contracts/manager.js';
import type { RawResponseEvidence } from '../result/raw-response.js';

interface TerminalEvidence {
  readonly usage?: AgentUsage;
}

type TerminalCandidate =
  | Readonly<
      {
        readonly status: 'succeeded';
        readonly value: Record<string, unknown>;
      } & TerminalEvidence
    >
  | Readonly<
      {
        readonly status: 'failed';
        readonly code?: AgentFault['code'];
        readonly reason?: string;
        readonly evidence?: RawResponseEvidence;
      } & TerminalEvidence
    >
  | Readonly<{ readonly status: 'cancelled' } & TerminalEvidence>
  | Readonly<{ readonly status: 'timed_out' } & TerminalEvidence>;

export type ExecutionOutcome = TerminalCandidate;

export class TerminalArbiter {
  private readonly candidate: Promise<ExecutionOutcome>;
  private resolveCandidate!: (outcome: ExecutionOutcome) => void;
  private outcome: ExecutionOutcome | undefined;
  private readonly wallTimer: ReturnType<typeof setTimeout>;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    wallClockTimeoutMs: number,
    private readonly idleTimeoutMs: number,
    private readonly onTimeout: () => void,
  ) {
    this.candidate = new Promise((resolve) => {
      this.resolveCandidate = resolve;
    });
    this.wallTimer = setTimeout(() => {
      this.commit({ status: 'timed_out' });
      this.onTimeout();
    }, wallClockTimeoutMs);
  }

  completion(): Promise<ExecutionOutcome> {
    return this.candidate;
  }

  current(): ExecutionOutcome | undefined {
    return this.outcome;
  }

  commit(candidate: ExecutionOutcome): boolean {
    if (this.outcome !== undefined) return false;
    this.outcome = Object.freeze(candidate);
    this.clearDeadlines();
    this.resolveCandidate(this.outcome);
    return true;
  }

  observeActivity(): void {
    if (this.outcome !== undefined) return;
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.commit({ status: 'timed_out' });
      this.onTimeout();
    }, this.idleTimeoutMs);
  }

  private clearDeadlines(): void {
    clearTimeout(this.wallTimer);
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
  }
}
