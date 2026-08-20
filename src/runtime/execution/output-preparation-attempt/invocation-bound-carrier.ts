export abstract class InvocationBoundCarrier {
  readonly #invocationToken: object;
  readonly invocationId: string;
  readonly outputDirectory: string;

  static isBoundToToken(carrier: unknown, token: object): boolean {
    return (
      typeof carrier === 'object' &&
      carrier !== null &&
      #invocationToken in carrier &&
      carrier.#invocationToken === token
    );
  }

  protected constructor(
    input: Readonly<{ invocationId: string; outputDirectory: string; invocationToken: object }>,
  ) {
    this.#invocationToken = input.invocationToken;
    this.invocationId = input.invocationId;
    this.outputDirectory = input.outputDirectory;
    Object.freeze(this.#invocationToken);
    Object.freeze(this);
  }
}
