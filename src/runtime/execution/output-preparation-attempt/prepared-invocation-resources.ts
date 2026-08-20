import { InvocationBoundCarrier } from './invocation-bound-carrier.js';

export class PreparedInvocationResources extends InvocationBoundCarrier {
  private constructor(
    input: Readonly<{ invocationId: string; outputDirectory: string; invocationToken: object }>,
  ) {
    super(input);
  }

  static create(
    input: Readonly<{ invocationId: string; outputDirectory: string; invocationToken: object }>,
  ): PreparedInvocationResources {
    return new PreparedInvocationResources(input);
  }
}
