export class ClaimedInvocationOutput {
  readonly #token: object;
  readonly invocationId: string;
  readonly outputDirectory: string;

  private constructor(input: Readonly<{ invocationId: string; outputDirectory: string }>) {
    this.#token = Object.freeze({});
    this.invocationId = input.invocationId;
    this.outputDirectory = input.outputDirectory;
    Object.freeze(this);
  }

  static create(
    input: Readonly<{ invocationId: string; outputDirectory: string }>,
  ): ClaimedInvocationOutput {
    return new ClaimedInvocationOutput(input);
  }

  static isAuthentic(session: unknown): session is ClaimedInvocationOutput {
    return (
      typeof session === 'object' &&
      session !== null &&
      #token in session &&
      session.#token !== undefined
    );
  }
}
