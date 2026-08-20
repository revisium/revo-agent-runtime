export abstract class InvocationTokenCarrier {
  readonly #token: object;
  readonly invocationId: string;

  static isBoundToToken(carrier: unknown, token: object): boolean {
    return (
      typeof carrier === 'object' &&
      carrier !== null &&
      #token in carrier &&
      carrier.#token === token
    );
  }

  protected constructor(input: Readonly<{ invocationId: string; invocationToken: object }>) {
    this.#token = input.invocationToken;
    this.invocationId = input.invocationId;
    Object.freeze(this.#token);
  }
}
