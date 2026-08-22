import type { RawFinalResponsePartition } from './raw-final-response-partition.js';
import type { RawFinalResponseReason } from './raw-final-response-reason.js';

export class RawFinalResponseEligibility {
  readonly #invocationToken: object;
  readonly partition: RawFinalResponsePartition;
  readonly reason: RawFinalResponseReason;

  private constructor(
    input: Readonly<{
      invocationToken: object;
      partition: RawFinalResponsePartition;
      reason: RawFinalResponseReason;
    }>,
  ) {
    this.#invocationToken = input.invocationToken;
    this.partition = input.partition;
    this.reason = input.reason;
    Object.freeze(this);
  }

  static create(input: {
    invocationToken: object;
    partition: RawFinalResponsePartition;
    reason: RawFinalResponseReason;
  }): RawFinalResponseEligibility {
    return new RawFinalResponseEligibility(input);
  }

  static isBoundToToken(value: unknown, token: object): boolean {
    return RawFinalResponseEligibility.isAuthentic(value) && value.#invocationToken === token;
  }

  static isAuthentic(value: unknown): value is RawFinalResponseEligibility {
    return (
      typeof value === 'object' &&
      value !== null &&
      #invocationToken in value &&
      value.#invocationToken !== undefined
    );
  }
}
