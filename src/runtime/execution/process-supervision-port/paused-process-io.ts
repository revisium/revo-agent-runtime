import { InvocationTokenCarrier } from './invocation-token-carrier.js';

export class PausedProcessIo extends InvocationTokenCarrier {
  readonly #brand: object;

  private constructor(input: Readonly<{ invocationId: string; invocationToken: object }>) {
    super(input);
    this.#brand = Object.freeze({});
    Object.freeze(this);
  }

  static create(
    input: Readonly<{ invocationId: string; invocationToken: object }>,
  ): PausedProcessIo {
    return new PausedProcessIo(input);
  }

  static override isBoundToToken(io: unknown, token: object): boolean {
    return PausedProcessIo.isAuthentic(io) && InvocationTokenCarrier.isBoundToToken(io, token);
  }

  static isAuthentic(io: unknown): io is PausedProcessIo {
    return typeof io === 'object' && io !== null && #brand in io && io.#brand !== undefined;
  }
}
