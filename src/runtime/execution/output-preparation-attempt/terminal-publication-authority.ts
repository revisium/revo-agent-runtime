import { InvocationBoundCarrier } from './invocation-bound-carrier.js';

export class TerminalPublicationAuthority extends InvocationBoundCarrier {
  private constructor(
    input: Readonly<{ invocationId: string; outputDirectory: string; invocationToken: object }>,
  ) {
    super(input);
  }

  static create(
    input: Readonly<{ invocationId: string; outputDirectory: string; invocationToken: object }>,
  ): TerminalPublicationAuthority {
    return new TerminalPublicationAuthority(input);
  }
}
