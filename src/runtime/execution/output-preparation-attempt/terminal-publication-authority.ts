export class TerminalPublicationAuthority {
  readonly #invocationToken: object;
  readonly invocationId: string;
  readonly outputDirectory: string;

  private constructor(
    input: Readonly<{ invocationId: string; outputDirectory: string; invocationToken: object }>,
  ) {
    this.#invocationToken = input.invocationToken;
    this.invocationId = input.invocationId;
    this.outputDirectory = input.outputDirectory;
    Object.freeze(this.#invocationToken);
    Object.freeze(this);
  }

  static create(
    input: Readonly<{ invocationId: string; outputDirectory: string; invocationToken: object }>,
  ): TerminalPublicationAuthority {
    return new TerminalPublicationAuthority(input);
  }
}
