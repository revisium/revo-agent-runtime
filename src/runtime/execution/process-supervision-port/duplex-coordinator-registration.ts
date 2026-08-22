import { DUPLEX_COORDINATOR_STATE } from './duplex-coordinator-state.js';
import { InvocationTokenCarrier } from './invocation-token-carrier.js';

const deferred = <Value>(): Readonly<{
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (resolve === undefined) throw new Error('Unable to allocate duplex completion promise.');
  return Object.freeze({ promise, resolve });
};

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
    const registration = new DuplexCoordinatorRegistration(input);
    DUPLEX_COORDINATOR_STATE.set(registration, {
      deferred: deferred(),
      committed: false,
    });
    return registration;
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
