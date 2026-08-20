import { InvocationTokenCarrier } from './invocation-token-carrier.js';

export class DuplexCoordinatorRegistration extends InvocationTokenCarrier {
  readonly #brand: object;

  private constructor(input: Readonly<{ invocationId: string; invocationToken: object }>) {
    super(input);
    this.#brand = Object.freeze({});
    Object.freeze(this);
  }

  static create(
    input: Readonly<{ invocationId: string; invocationToken: object }>,
  ): DuplexCoordinatorRegistration {
    return new DuplexCoordinatorRegistration(input);
  }

  static override isBoundToToken(registration: unknown, token: object): boolean {
    return (
      DuplexCoordinatorRegistration.isAuthentic(registration) &&
      InvocationTokenCarrier.isBoundToToken(registration, token)
    );
  }

  static isAuthentic(registration: unknown): registration is DuplexCoordinatorRegistration {
    return (
      typeof registration === 'object' &&
      registration !== null &&
      #brand in registration &&
      registration.#brand !== undefined
    );
  }
}
