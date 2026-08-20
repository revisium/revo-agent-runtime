import { InvocationTokenCarrier } from './invocation-token-carrier.js';

export class SpawnAcceptedProcess extends InvocationTokenCarrier {
  readonly #brand: object;
  readonly spawnedAt: number;

  private constructor(
    input: Readonly<{ invocationId: string; invocationToken: object; spawnedAt: number }>,
  ) {
    super(input);
    this.#brand = Object.freeze({});
    this.spawnedAt = input.spawnedAt;
    Object.freeze(this);
  }

  static create(
    input: Readonly<{ invocationId: string; invocationToken: object; spawnedAt: number }>,
  ): SpawnAcceptedProcess {
    return new SpawnAcceptedProcess(input);
  }

  static override isBoundToToken(process: unknown, token: object): boolean {
    return (
      SpawnAcceptedProcess.isAuthentic(process) &&
      InvocationTokenCarrier.isBoundToToken(process, token)
    );
  }

  static isAuthentic(process: unknown): process is SpawnAcceptedProcess {
    return (
      typeof process === 'object' &&
      process !== null &&
      #brand in process &&
      process.#brand !== undefined
    );
  }
}
