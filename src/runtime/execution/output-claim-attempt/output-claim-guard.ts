import type { OutputClaimReconciliation } from './output-claim-reconciliation.js';

interface RetainedClaimState {
  reconciliation: OutputClaimReconciliation;
}

export class OutputClaimGuard {
  readonly #token: object;
  readonly #state: RetainedClaimState;
  readonly invocationId: string;
  readonly outputDirectory: string;

  private constructor(input: Readonly<{ invocationId: string; outputDirectory: string }>) {
    this.#token = Object.freeze({});
    this.#state = { reconciliation: Object.freeze({ status: 'unknown', reason: 'pending' }) };
    this.invocationId = input.invocationId;
    this.outputDirectory = input.outputDirectory;
    Object.freeze(this);
  }

  static create(
    input: Readonly<{ invocationId: string; outputDirectory: string }>,
  ): OutputClaimGuard {
    return new OutputClaimGuard(input);
  }

  static reconcile(guard: OutputClaimGuard, reconciliation: OutputClaimReconciliation): void {
    guard.#state.reconciliation = Object.freeze(reconciliation);
  }

  static inspect(guard: unknown): OutputClaimReconciliation {
    if (!OutputClaimGuard.isAuthentic(guard)) {
      return Object.freeze({ status: 'unknown', reason: 'unreconciled' });
    }
    return guard.#state.reconciliation;
  }

  private static isAuthentic(guard: unknown): guard is OutputClaimGuard {
    return (
      typeof guard === 'object' && guard !== null && #token in guard && guard.#token !== undefined
    );
  }
}
