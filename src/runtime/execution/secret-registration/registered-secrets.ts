export class RegisteredSecrets {
  readonly #token: object;
  readonly #secretValues: readonly string[];

  private constructor(secretValues: readonly string[]) {
    this.#token = Object.freeze({});
    this.#secretValues = Object.freeze([...secretValues]);
    Object.freeze(this);
  }

  static create(secretValues: readonly string[]): RegisteredSecrets {
    return new RegisteredSecrets(secretValues);
  }

  static reveal(capability: unknown): readonly string[] | undefined {
    if (!RegisteredSecrets.isAuthentic(capability)) return undefined;
    return capability.#secretValues;
  }

  static isAuthentic(capability: unknown): capability is RegisteredSecrets {
    return (
      typeof capability === 'object' &&
      capability !== null &&
      #token in capability &&
      capability.#token !== undefined
    );
  }
}
